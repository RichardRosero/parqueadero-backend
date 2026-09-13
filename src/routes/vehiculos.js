// routes/vehiculos.js — seccion 5: tipos de vehiculo, tarifas y planes internos
const express = require("express");
const { v4: uuid } = require("uuid");
const db = require("../db");
const { requiereAuth, requiereRol, validarLicencia } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { errorConEstado } = require("../utils/errores");
const { MAX_TIPOS_TOTAL } = require("../utils/tiposDefault");

const router = express.Router();
router.use(requiereAuth, validarLicencia);

// --- Tipos de vehiculo y tarifas ---
router.post("/tipos", requiereRol("admin"), asyncHandler(async (req, res) => {
  const { parqueadero_id, nombre, tarifa_hora, tarifa_fraccion, duracion_fraccion_minutos } = req.body;
  if (!parqueadero_id) throw errorConEstado(400, "Falta parqueadero_id");
  if (!nombre) throw errorConEstado(400, "Falta el nombre del tipo de vehiculo");
  if (tarifa_hora == null || tarifa_fraccion == null || isNaN(tarifa_hora) || isNaN(tarifa_fraccion)) {
    throw errorConEstado(400, "tarifa_hora y tarifa_fraccion deben ser numeros validos");
  }

  const existentes = db.prepare("SELECT COUNT(*) AS n FROM tipos_vehiculo WHERE parqueadero_id = ?").get(parqueadero_id).n;
  if (existentes >= MAX_TIPOS_TOTAL) {
    throw errorConEstado(400, `Ya alcanzaste el máximo de ${MAX_TIPOS_TOTAL} tipos de vehículo para esta sede.`);
  }

  const id = uuid();
  db.prepare(`
    INSERT INTO tipos_vehiculo (id, parqueadero_id, nombre, tarifa_hora, tarifa_fraccion, duracion_fraccion_minutos)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, parqueadero_id, nombre, tarifa_hora, tarifa_fraccion, duracion_fraccion_minutos || 15);
  res.status(201).json({ id });
}));

router.get("/tipos/:parqueaderoId", requiereAuth, (req, res) => {
  const tipos = db.prepare("SELECT * FROM tipos_vehiculo WHERE parqueadero_id = ?").all(req.params.parqueaderoId);
  res.json(tipos);
});

// Editar un tipo de vehiculo ya creado (nombre y/o tarifas)
router.patch("/tipos/:id", requiereRol("admin"), asyncHandler(async (req, res) => {
  const { nombre, tarifa_hora, tarifa_fraccion, duracion_fraccion_minutos } = req.body;

  const tipo = db.prepare(`
    SELECT tv.* FROM tipos_vehiculo tv
    JOIN parqueaderos p ON p.id = tv.parqueadero_id
    WHERE tv.id = ? AND p.negocio_id = ?
  `).get(req.params.id, req.negocio.id);
  if (!tipo) throw errorConEstado(404, "Tipo de vehiculo no encontrado");

  if (tarifa_hora != null && isNaN(tarifa_hora)) throw errorConEstado(400, "tarifa_hora debe ser un numero valido");
  if (tarifa_fraccion != null && isNaN(tarifa_fraccion)) throw errorConEstado(400, "tarifa_fraccion debe ser un numero valido");

  db.prepare(`
    UPDATE tipos_vehiculo
    SET nombre = COALESCE(?, nombre),
        tarifa_hora = COALESCE(?, tarifa_hora),
        tarifa_fraccion = COALESCE(?, tarifa_fraccion),
        duracion_fraccion_minutos = COALESCE(?, duracion_fraccion_minutos)
    WHERE id = ?
  `).run(nombre || null, tarifa_hora ?? null, tarifa_fraccion ?? null, duracion_fraccion_minutos ?? null, req.params.id);

  res.json({ ok: true });
}));

// Eliminar un tipo de vehiculo. No se permite si es el ultimo de la sede
// (toda sede necesita al menos 1, ver creacion de sede) ni si hay vehiculos
// actualmente adentro registrados con ese tipo (evita perder de vista una
// operacion en curso). El historial ya cerrado no se ve afectado: cada
// registro cerrado guarda su propio valor_parqueo, no depende de que el
// tipo siga existiendo.
router.delete("/tipos/:id", requiereRol("admin"), asyncHandler(async (req, res) => {
  const tipo = db.prepare(`
    SELECT tv.* FROM tipos_vehiculo tv
    JOIN parqueaderos p ON p.id = tv.parqueadero_id
    WHERE tv.id = ? AND p.negocio_id = ?
  `).get(req.params.id, req.negocio.id);
  if (!tipo) throw errorConEstado(404, "Tipo de vehiculo no encontrado");

  const totalTipos = db.prepare("SELECT COUNT(*) AS n FROM tipos_vehiculo WHERE parqueadero_id = ?").get(tipo.parqueadero_id).n;
  if (totalTipos <= 1) {
    throw errorConEstado(400, "No puedes eliminar el único tipo de vehículo de esta sede. Crea otro primero si quieres reemplazarlo.");
  }

  const enUso = db.prepare("SELECT COUNT(*) AS n FROM registros WHERE tipo_vehiculo_id = ? AND estado = 'activo'").get(req.params.id).n;
  if (enUso > 0) {
    throw errorConEstado(400, `No puedes eliminar "${tipo.nombre}": todavía hay ${enUso} vehículo(s) adentro con ese tipo.`);
  }

  db.prepare("DELETE FROM tipos_vehiculo WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
}));

// --- Vehiculos con plan interno (mensualidad) ---
router.post("/", asyncHandler(async (req, res) => {
  const { parqueadero_id, placa, tipo_vehiculo_id, plan_interno_activo, plan_interno_valor, plan_interno_vence } = req.body;
  if (!parqueadero_id) throw errorConEstado(400, "Falta parqueadero_id");
  if (!placa) throw errorConEstado(400, "Falta la placa");

  const id = uuid();
  db.prepare(`
    INSERT INTO vehiculos (id, parqueadero_id, placa, tipo_vehiculo_id, plan_interno_activo, plan_interno_valor, plan_interno_vence)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(parqueadero_id, placa) DO UPDATE SET
      tipo_vehiculo_id = excluded.tipo_vehiculo_id,
      plan_interno_activo = excluded.plan_interno_activo,
      plan_interno_valor = excluded.plan_interno_valor,
      plan_interno_vence = excluded.plan_interno_vence
  `).run(id, parqueadero_id, placa.toUpperCase(), tipo_vehiculo_id || null, plan_interno_activo ? 1 : 0, plan_interno_valor || null, plan_interno_vence || null);
  res.status(201).json({ ok: true });
}));

// Dar de baja / bloquear un vehiculo con plan interno (seccion 5)
router.patch("/:id/bloquear", requiereRol("admin"), (req, res) => {
  db.prepare("UPDATE vehiculos SET bloqueado = 1, plan_interno_activo = 0 WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Vehiculos cuya mensualidad vence en los proximos `dias` (para la alerta del dashboard, seccion 5)
router.get("/vencimientos/:parqueaderoId", (req, res) => {
  const dias = Number(req.query.dias || 3);
  const limite = new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString();
  const vehiculos = db.prepare(`
    SELECT * FROM vehiculos
    WHERE parqueadero_id = ? AND plan_interno_activo = 1 AND plan_interno_vence <= ?
    ORDER BY plan_interno_vence ASC
  `).all(req.params.parqueaderoId, limite);
  res.json(vehiculos);
});

module.exports = router;
