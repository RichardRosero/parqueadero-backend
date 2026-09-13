// utils/accesoSedes.js
// Verifica que el usuario autenticado tenga permiso para ver datos de una
// sede puntual: el admin, cualquier sede de su propio negocio; el operador,
// solo las sedes que el admin le asigno (ver routes/operadores.js). Se usa
// en reportes.js y panico.js para que un operador no pueda pedir el reporte
// de una sede ajena solo adivinando/probando su id.
const db = require("../db");

function tieneAccesoASede(usuario, parqueaderoId) {
  if (usuario.rol === "admin") {
    const sede = db.prepare("SELECT id FROM parqueaderos WHERE id = ? AND negocio_id = ?").get(parqueaderoId, usuario.negocioId);
    return !!sede;
  }

  const sede = db.prepare(`
    SELECT p.id FROM parqueaderos p
    WHERE p.id = ? AND (
      p.id IN (SELECT parqueadero_id FROM usuarios_sedes WHERE usuario_id = ?)
      OR p.id = (SELECT parqueadero_id FROM usuarios WHERE id = ?)
    )
  `).get(parqueaderoId, usuario.id, usuario.id);
  return !!sede;
}

module.exports = { tieneAccesoASede };
