// routes/panico.js — seccion 12: boton de panico, auditoria inmutable
//
// A proposito, este archivo SOLO expone POST (crear) y GET (listar/leer).
// No existen rutas PUT/PATCH/DELETE para esta tabla: un registro de panico
// no se debe poder editar ni borrar una vez creado.

const express = require("express");
const { v4: uuid } = require("uuid");
const db = require("../db");
const { requiereAuth, requiereRol, validarLicencia } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { errorConEstado } = require("../utils/errores");
const { calcularValorAPagar } = require("../services/tarifaEngine");
const { tieneAccesoASede } = require("../utils/accesoSedes");

const router = express.Router();
router.use(requiereAuth, validarLicencia);

const MOTIVO_PERDIDA_TICKET = "Pérdida de ticket/celular del cliente";

function round2(n) {
  return Math.round(n * 100) / 100;
}

// No se pide el codigo del ticket: si el cliente perdio el ticket/celular no
// lo va a tener, y si el sistema fallo puede que ni siquiera se haya
// generado. Se busca la placa directamente.
//
// - "Perdida de ticket/celular del cliente": debe existir un registro activo
//   con esa placa (el sistema si tiene el dato, solo el cliente perdio su
//   comprobante). Se cierra el registro cobrando la tarifa normal MAS la
//   multa configurada para la sede (si el admin puso alguna).
// - "Fallo del sistema": se busca igual por placa. Si se encuentra, se
//   cierra cobrando la tarifa normal (sin multa, no es culpa del cliente).
//   Si NO se encuentra (el sistema fallo incluso al guardar la entrada), no
//   hay nada que cerrar, pero de todas formas se deja salir el vehiculo y
//   la placa queda registrada en el log de panico para auditoria/reportes.
router.post("/", requiereRol("admin", "guardia"), asyncHandler(async (req, res) => {
  const { parqueadero_id, motivo, placa } = req.body;
  if (!parqueadero_id || !motivo || !placa) {
    throw errorConEstado(400, "Faltan datos: parqueadero_id, motivo y placa son obligatorios");
  }

  const registro = db.prepare(`
    SELECT * FROM registros WHERE parqueadero_id = ? AND placa = ? AND estado = 'activo'
    ORDER BY hora_entrada DESC LIMIT 1
  `).get(parqueadero_id, placa.toUpperCase());

  if (motivo === MOTIVO_PERDIDA_TICKET && !registro) {
    throw errorConEstado(404, `No hay un registro activo con la placa "${placa.toUpperCase()}" en esta sede. Verifica que esté bien escrita.`);
  }

  let valorCobrado = null;
  if (registro) {
    const parqueadero = db.prepare("SELECT * FROM parqueaderos WHERE id = ?").get(parqueadero_id);
    const tipoVehiculo = db.prepare("SELECT * FROM tipos_vehiculo WHERE id = ?").get(registro.tipo_vehiculo_id);
    const vehiculo = db.prepare("SELECT * FROM vehiculos WHERE parqueadero_id = ? AND placa = ?").get(parqueadero_id, registro.placa);

    let valor = 0;
    if (tipoVehiculo) {
      valor = calcularValorAPagar({
        horaEntrada: new Date(registro.hora_entrada),
        horaSalida: new Date(),
        tipoVehiculo,
        vehiculo,
        toleranciaHoras: parqueadero.tolerancia_vencimiento_horas,
      }).valor;
    }
    const multa = motivo === MOTIVO_PERDIDA_TICKET ? (parqueadero.monto_multa_perdida_ticket || 0) : 0;
    valorCobrado = round2(valor + multa);

    db.prepare(`
      UPDATE registros
      SET hora_salida = ?, valor_parqueo = ?, recargo_notificacion = 0, metodo_notificacion_salida = 'ninguno', guardia_salida_id = ?, estado = 'cerrado'
      WHERE id = ?
    `).run(new Date().toISOString(), valorCobrado, req.usuario.id, registro.id);
  }
  // Si no hay registro (solo puede pasar con "Fallo del sistema"), no hay
  // nada que cerrar: se deja constancia abajo en panico_log igual.

  const id = uuid();
  db.prepare(`
    INSERT INTO panico_log (id, parqueadero_id, guardia_id, codigo_ingresado, motivo, placa)
    VALUES (?, ?, ?, '', ?, ?)
  `).run(id, parqueadero_id, req.usuario.id, motivo, placa.toUpperCase());

  // TODO: disparar notificacion push inmediata al administrador (seccion 12).
  // Requiere integrar un proveedor de push (ej. Firebase Cloud Messaging)
  // y guardar el token de push del dispositivo del admin al iniciar sesion.

  res.status(201).json({ id, ok: true, valorCobrado, registroEncontrado: !!registro });
}));

// GET /panico/:parqueaderoId?desde=ISO&hasta=ISO — para el reporte de panico
// (ver ReportesScreen.js). Sin desde/hasta, devuelve todo el historial (uso
// interno/administrativo). Los operadores tambien pueden consultarlo, pero
// solo de una sede a la que tengan acceso (ver tieneAccesoASede).
router.get("/:parqueaderoId", requiereRol("admin", "guardia"), (req, res) => {
  if (!tieneAccesoASede(req.usuario, req.params.parqueaderoId)) {
    return res.status(403).json({ error: "No tienes acceso a esta sede" });
  }

  const { desde, hasta } = req.query;
  const filtroFechas = desde && hasta ? "AND p.creado_en BETWEEN ? AND ?" : "";
  const parametros = desde && hasta ? [req.params.parqueaderoId, desde, hasta] : [req.params.parqueaderoId];

  const registros = db.prepare(`
    SELECT p.*, u.nombre AS guardia_nombre FROM panico_log p
    JOIN usuarios u ON u.id = p.guardia_id
    WHERE p.parqueadero_id = ? ${filtroFechas} ORDER BY p.creado_en DESC
  `).all(...parametros);
  res.json(registros);
});

module.exports = router;
