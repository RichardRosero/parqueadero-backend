// routes/reportes.js — seccion 10: reportes y exportacion
const express = require("express");
const db = require("../db");
const { requiereAuth, requiereRol, validarLicencia } = require("../middleware/auth");
const { tieneAccesoASede } = require("../utils/accesoSedes");

const router = express.Router();
// Los operadores tambien pueden consultar reportes (solo lectura, no pueden
// editar nada); Configuracion sigue siendo exclusiva del admin. Cada uno
// solo puede pedir el reporte de una sede a la que tenga acceso (ver
// tieneAccesoASede): el admin, las de su negocio; el operador, solo las
// sedes que el admin le asigno.
router.use(requiereAuth, validarLicencia, requiereRol("admin", "guardia"));

// GET /reportes/:parqueaderoId?desde=ISO&hasta=ISO
router.get("/:parqueaderoId", (req, res) => {
  if (!tieneAccesoASede(req.usuario, req.params.parqueaderoId)) {
    return res.status(403).json({ error: "No tienes acceso a esta sede" });
  }

  const { desde, hasta } = req.query;
  if (!desde || !hasta) return res.status(400).json({ error: "Los parametros desde y hasta son obligatorios (ISO 8601)" });

  const filas = db.prepare(`
    SELECT r.*, ue.nombre AS operador_entrada, us.nombre AS operador_salida
    FROM registros r
    LEFT JOIN usuarios ue ON ue.id = r.guardia_entrada_id
    LEFT JOIN usuarios us ON us.id = r.guardia_salida_id
    WHERE r.parqueadero_id = ? AND r.estado = 'cerrado' AND r.hora_salida BETWEEN ? AND ?
    ORDER BY r.hora_salida DESC
  `).all(req.params.parqueaderoId, desde, hasta);

  const ingresoParqueo = round2(filas.reduce((sum, r) => sum + (r.valor_parqueo || 0), 0));
  const recargoNotificacion = round2(filas.reduce((sum, r) => sum + (r.recargo_notificacion || 0), 0));

  res.json({
    rango: { desde, hasta },
    totalRegistros: filas.length,
    ingresoParqueo,
    recargoNotificacion, // se reporta separado del ingreso de parqueo, ver seccion 10
    totalGeneral: round2(ingresoParqueo + recargoNotificacion),
    detalle: filas,
  });
});

// Ingresos por guardia/turno
router.get("/:parqueaderoId/por-guardia", (req, res) => {
  if (!tieneAccesoASede(req.usuario, req.params.parqueaderoId)) {
    return res.status(403).json({ error: "No tienes acceso a esta sede" });
  }

  const { desde, hasta } = req.query;
  const filas = db.prepare(`
    SELECT u.nombre AS guardia, COUNT(*) AS registros, SUM(r.valor_parqueo) AS ingreso_parqueo
    FROM registros r
    JOIN usuarios u ON u.id = r.guardia_salida_id
    WHERE r.parqueadero_id = ? AND r.estado = 'cerrado' AND r.hora_salida BETWEEN ? AND ?
    GROUP BY r.guardia_salida_id
  `).all(req.params.parqueaderoId, desde, hasta);
  res.json(filas);
});

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = router;
