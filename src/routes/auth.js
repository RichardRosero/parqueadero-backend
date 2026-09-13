// routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { firmarToken } = require("../middleware/auth");

const router = express.Router();

// --- Login del administrador ---
// TODO real: reemplazar por verificacion de token de Google/Apple.
// El flujo real es: el celular hace el login nativo con Google/Apple SDK,
// obtiene un id_token, y lo manda aqui para que el backend lo valide
// contra los servidores de Google/Apple (google-auth-library / verificacion
// de JWT de Apple) antes de emitir el token propio de la app.
router.post("/admin/login", (req, res) => {
  const { email, password } = req.body; // en produccion: { idToken, proveedor: 'google'|'apple' }
  if (!email || !password) return res.status(400).json({ error: "Email y password son obligatorios" });

  const negocio = db.prepare("SELECT * FROM negocios WHERE email = ?").get(email);
  if (!negocio) return res.status(401).json({ error: "Credenciales invalidas" });

  // Solo para pruebas locales (ver seed.js). En produccion no existe password propio.
  if (!negocio.password_hash || !bcrypt.compareSync(password, negocio.password_hash)) {
    return res.status(401).json({ error: "Credenciales invalidas" });
  }

  const admin = db.prepare("SELECT * FROM usuarios WHERE negocio_id = ? AND rol = 'admin'").get(negocio.id);
  const token = firmarToken(admin);
  res.json({ token, negocio: { id: negocio.id, plan: negocio.plan, nombre: negocio.nombre_admin } });
});

// --- Login del operador (usuario interno + contraseña, creado por el admin en /operadores) ---
router.post("/guardia/login", (req, res) => {
  const { usuario, password } = req.body;
  if (!usuario || !password) return res.status(400).json({ error: "Usuario y contraseña son obligatorios" });

  const guardia = db.prepare("SELECT * FROM usuarios WHERE usuario = ? AND rol = 'guardia' AND activo = 1").get(usuario);
  if (!guardia || !guardia.pin_hash || !bcrypt.compareSync(password, guardia.pin_hash)) {
    return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
  }
  const parqueadero = db.prepare("SELECT moneda FROM parqueaderos WHERE id = ?").get(guardia.parqueadero_id);
  const token = firmarToken(guardia);
  res.json({
    token,
    guardia: { id: guardia.id, nombre: guardia.nombre, parqueaderoId: guardia.parqueadero_id, moneda: parqueadero?.moneda || "USD" },
  });
});

module.exports = router;
