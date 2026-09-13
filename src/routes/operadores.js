// routes/operadores.js — CRUD de operadores (usuarios con rol 'guardia').
// El admin los crea con usuario + contraseña (nunca via login Google/Apple,
// ver seccion 2.2) y les asigna 1 o mas sedes de su propio negocio. Un
// operador solo puede registrar entradas/salidas, ver reportes y usar el
// boton de panico en las sedes que se le asignaron aqui; no tiene acceso a
// Configuracion (eso se controla en la app movil, ver AppNavigator.js).
const express = require("express");
const { v4: uuid } = require("uuid");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { requiereAuth, requiereRol, validarLicencia } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { errorConEstado } = require("../utils/errores");

const router = express.Router();
router.use(requiereAuth, validarLicencia, requiereRol("admin"));

function validarSedeIds(sedeIds, negocioId) {
  if (!Array.isArray(sedeIds) || sedeIds.length === 0) {
    throw errorConEstado(400, "Selecciona al menos una sede para el operador.");
  }
  const sedesDelNegocio = db.prepare("SELECT id FROM parqueaderos WHERE negocio_id = ? AND activo = 1").all(negocioId).map((s) => s.id);
  const invalidas = sedeIds.filter((id) => !sedesDelNegocio.includes(id));
  if (invalidas.length > 0) {
    throw errorConEstado(400, "Una o mas sedes seleccionadas no son validas.");
  }
}

// Incluye tambien la sede "vieja" (columna usuarios.parqueadero_id) para que
// un operador creado a mano antes de existir esta pantalla (ej. seed.js)
// tambien se vea con su sede correcta en la lista.
function adjuntarSedes(operadores) {
  const sedesStmt = db.prepare(`
    SELECT DISTINCT p.id, p.nombre FROM parqueaderos p
    WHERE p.activo = 1 AND (
      p.id IN (SELECT parqueadero_id FROM usuarios_sedes WHERE usuario_id = ?)
      OR p.id = (SELECT parqueadero_id FROM usuarios WHERE id = ?)
    )
  `);
  for (const op of operadores) op.sedes = sedesStmt.all(op.id, op.id);
  return operadores;
}

router.get("/", (req, res) => {
  const operadores = db.prepare(`
    SELECT id, nombre, usuario, creado_en FROM usuarios
    WHERE negocio_id = ? AND rol = 'guardia' AND activo = 1
    ORDER BY creado_en DESC
  `).all(req.negocio.id);
  res.json(adjuntarSedes(operadores));
});

router.post("/", asyncHandler(async (req, res) => {
  const { nombre, usuario, password, sedeIds } = req.body;
  if (!nombre || !nombre.trim()) throw errorConEstado(400, "Falta el nombre del operador");
  if (!usuario || !usuario.trim()) throw errorConEstado(400, "Falta el usuario de acceso");
  if (!password || password.length < 4) throw errorConEstado(400, "La contraseña debe tener al menos 4 caracteres");
  validarSedeIds(sedeIds, req.negocio.id);

  const usuarioExistente = db.prepare("SELECT id FROM usuarios WHERE usuario = ?").get(usuario.trim());
  if (usuarioExistente) throw errorConEstado(400, `El usuario "${usuario.trim()}" ya está en uso. Elige otro.`);

  const id = uuid();
  db.prepare(`
    INSERT INTO usuarios (id, negocio_id, parqueadero_id, rol, nombre, usuario, pin_hash)
    VALUES (?, ?, NULL, 'guardia', ?, ?, ?)
  `).run(id, req.negocio.id, nombre.trim(), usuario.trim(), bcrypt.hashSync(password, 8));

  const insertarSede = db.prepare("INSERT INTO usuarios_sedes (usuario_id, parqueadero_id) VALUES (?, ?)");
  for (const sedeId of sedeIds) insertarSede.run(id, sedeId);

  res.status(201).json({ id });
}));

router.patch("/:id", asyncHandler(async (req, res) => {
  const { nombre, usuario, password, sedeIds } = req.body;
  const operador = db.prepare("SELECT * FROM usuarios WHERE id = ? AND negocio_id = ? AND rol = 'guardia' AND activo = 1").get(req.params.id, req.negocio.id);
  if (!operador) throw errorConEstado(404, "Operador no encontrado");

  if (!nombre || !nombre.trim()) throw errorConEstado(400, "Falta el nombre del operador");
  if (!usuario || !usuario.trim()) throw errorConEstado(400, "Falta el usuario de acceso");
  if (password && password.length < 4) throw errorConEstado(400, "La contraseña debe tener al menos 4 caracteres");
  validarSedeIds(sedeIds, req.negocio.id);

  const usuarioEnUso = db.prepare("SELECT id FROM usuarios WHERE usuario = ? AND id != ?").get(usuario.trim(), req.params.id);
  if (usuarioEnUso) throw errorConEstado(400, `El usuario "${usuario.trim()}" ya está en uso. Elige otro.`);

  db.prepare(`
    UPDATE usuarios SET nombre = ?, usuario = ?, pin_hash = COALESCE(?, pin_hash)
    WHERE id = ?
  `).run(nombre.trim(), usuario.trim(), password ? bcrypt.hashSync(password, 8) : null, req.params.id);

  db.prepare("DELETE FROM usuarios_sedes WHERE usuario_id = ?").run(req.params.id);
  const insertarSede = db.prepare("INSERT INTO usuarios_sedes (usuario_id, parqueadero_id) VALUES (?, ?)");
  for (const sedeId of sedeIds) insertarSede.run(req.params.id, sedeId);

  res.json({ ok: true });
}));

// Eliminar un operador es borrado logico (activo = 0), igual que las sedes:
// nunca se borra su historial de registros/panico ya generado.
router.delete("/:id", asyncHandler(async (req, res) => {
  const operador = db.prepare("SELECT * FROM usuarios WHERE id = ? AND negocio_id = ? AND rol = 'guardia' AND activo = 1").get(req.params.id, req.negocio.id);
  if (!operador) throw errorConEstado(404, "Operador no encontrado");

  db.prepare("UPDATE usuarios SET activo = 0 WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
}));

module.exports = router;
