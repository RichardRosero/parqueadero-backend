// routes/parqueaderos.js — sedes del negocio (seccion 6: multi-parqueadero)
const express = require("express");
const { v4: uuid } = require("uuid");
const db = require("../db");
const { requiereAuth, requiereRol, validarLicencia } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { errorConEstado } = require("../utils/errores");
const { TIPOS_DEFAULT, MAX_TIPOS_TOTAL } = require("../utils/tiposDefault");
const { generarCodigoSede } = require("../utils/codigo");

const router = express.Router();
router.use(requiereAuth, validarLicencia);

// Planes de 1 sola sede (ver seccion 13): no pueden crear una segunda.
// Solo el plan 'empresarial' permite multiples parqueaderos.
router.post("/", requiereRol("admin"), asyncHandler(async (req, res) => {
  const { nombre, moneda, codigo_region, capacidad_maxima, tipos } = req.body;
  if (!nombre) throw errorConEstado(400, "Falta el nombre de la sede");

  // El admin configura los tipos de vehiculo (con sus tarifas) como parte
  // del mismo formulario de creacion; la app no deja avanzar sin al menos
  // uno. Si por alguna razon llega vacio (ej. una integracion externa),
  // se usan los 3 tipos por defecto para que la sede nunca quede sin tipos.
  const tiposACrear = Array.isArray(tipos) && tipos.length > 0 ? tipos : TIPOS_DEFAULT;
  if (tiposACrear.length > MAX_TIPOS_TOTAL) {
    throw errorConEstado(400, `Como máximo se pueden crear ${MAX_TIPOS_TOTAL} tipos de vehículo por sede.`);
  }
  for (const t of tiposACrear) {
    if (!t.nombre || t.tarifa_hora == null || t.tarifa_fraccion == null || isNaN(t.tarifa_hora) || isNaN(t.tarifa_fraccion)) {
      throw errorConEstado(400, "Cada tipo de vehículo necesita nombre, tarifa por hora y tarifa por fracción válidos.");
    }
  }

  const existentes = db.prepare("SELECT COUNT(*) AS n FROM parqueaderos WHERE negocio_id = ? AND activo = 1").get(req.negocio.id).n;
  if (req.negocio.plan !== "empresarial" && existentes >= 1) {
    return res.status(403).json({
      error: "Tu plan actual permite un solo parqueadero. Sube al plan Empresarial para agregar mas sedes.",
    });
  }

  const nombreDuplicado = db.prepare("SELECT id FROM parqueaderos WHERE negocio_id = ? AND nombre = ? AND activo = 1").get(req.negocio.id, nombre);
  if (nombreDuplicado) throw errorConEstado(400, `Ya tienes una sede llamada "${nombre}". Elige un nombre distinto.`);

  const id = uuid();
  db.prepare(`
    INSERT INTO parqueaderos (id, negocio_id, codigo, nombre, moneda, codigo_region, capacidad_maxima)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.negocio.id, generarCodigoSede(), nombre, moneda || "USD", codigo_region || "+593", capacidad_maxima || null);

  const insertarTipo = db.prepare(`
    INSERT INTO tipos_vehiculo (id, parqueadero_id, nombre, tarifa_hora, tarifa_fraccion)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const t of tiposACrear) {
    insertarTipo.run(uuid(), id, t.nombre, t.tarifa_hora, t.tarifa_fraccion);
  }

  res.status(201).json({ id });
}));

// El admin ve todas las sedes activas de su negocio (sin cambios). Un
// operador (rol 'guardia') solo ve las sedes que el admin le asigno en
// /operadores; se incluye tambien parqueadero_id por compatibilidad con
// operadores viejos creados a mano (ej. seed.js) que aun usan esa columna
// en vez de la tabla usuarios_sedes.
router.get("/", requiereAuth, (req, res) => {
  if (req.usuario.rol === "admin") {
    const sedes = db.prepare("SELECT * FROM parqueaderos WHERE negocio_id = ? AND activo = 1").all(req.usuario.negocioId);
    return res.json(sedes);
  }
  const sedes = db.prepare(`
    SELECT DISTINCT p.* FROM parqueaderos p
    WHERE p.activo = 1 AND (
      p.id IN (SELECT parqueadero_id FROM usuarios_sedes WHERE usuario_id = ?)
      OR p.id = (SELECT parqueadero_id FROM usuarios WHERE id = ?)
    )
  `).all(req.usuario.id, req.usuario.id);
  res.json(sedes);
});

router.patch("/:id/config", requiereRol("admin"), asyncHandler(async (req, res) => {
  const { monto_recargo_whatsapp, monto_recargo_sms, webhook_pluma_url, tolerancia_vencimiento_horas, moneda, monto_multa_perdida_ticket } = req.body;
  db.prepare(`
    UPDATE parqueaderos
    SET monto_recargo_whatsapp = COALESCE(?, monto_recargo_whatsapp),
        monto_recargo_sms = COALESCE(?, monto_recargo_sms),
        webhook_pluma_url = COALESCE(?, webhook_pluma_url),
        tolerancia_vencimiento_horas = COALESCE(?, tolerancia_vencimiento_horas),
        moneda = COALESCE(?, moneda),
        monto_multa_perdida_ticket = COALESCE(?, monto_multa_perdida_ticket)
    WHERE id = ? AND negocio_id = ?
  `).run(
    monto_recargo_whatsapp ?? null,
    monto_recargo_sms ?? null,
    webhook_pluma_url ?? null,
    tolerancia_vencimiento_horas ?? null,
    moneda ?? null,
    monto_multa_perdida_ticket ?? null,
    req.params.id,
    req.negocio.id
  );
  res.json({ ok: true });
}));

// Eliminar una sede. Es un borrado logico (activo = 0), nunca se borran sus
// registros/reportes/historial de panico — solo deja de aparecer en la
// lista del admin y de poder usarse para operar. No se permite si tiene
// vehiculos actualmente adentro (evita perder de vista una operacion en
// curso), ni si tiene guardias asignados (quedarian sin sede valida).
router.delete("/:id", requiereRol("admin"), asyncHandler(async (req, res) => {
  const sede = db.prepare("SELECT * FROM parqueaderos WHERE id = ? AND negocio_id = ? AND activo = 1").get(req.params.id, req.negocio.id);
  if (!sede) throw errorConEstado(404, "Sede no encontrada");

  const registrosActivos = db.prepare("SELECT COUNT(*) AS n FROM registros WHERE parqueadero_id = ? AND estado = 'activo'").get(req.params.id).n;
  if (registrosActivos > 0) {
    throw errorConEstado(400, `No puedes eliminar "${sede.nombre}": todavía tiene ${registrosActivos} vehículo(s) adentro. Registra su salida primero.`);
  }

  const guardiasAsignados = db.prepare(`
    SELECT COUNT(*) AS n FROM usuarios u
    WHERE u.rol = 'guardia' AND u.activo = 1 AND (
      u.parqueadero_id = ?
      OR u.id IN (SELECT usuario_id FROM usuarios_sedes WHERE parqueadero_id = ?)
    )
  `).get(req.params.id, req.params.id).n;
  if (guardiasAsignados > 0) {
    throw errorConEstado(400, `No puedes eliminar "${sede.nombre}": tiene ${guardiasAsignados} guardia(s) asignado(s) a esta sede.`);
  }

  db.prepare("UPDATE parqueaderos SET activo = 0 WHERE id = ? AND negocio_id = ?").run(req.params.id, req.negocio.id);
  res.json({ ok: true });
}));

module.exports = router;
