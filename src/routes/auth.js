// routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const { v4: uuid } = require("uuid");
const { OAuth2Client } = require("google-auth-library");
const db = require("../db");
const { firmarToken } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { errorConEstado } = require("../utils/errores");

const router = express.Router();

// --- Login del administrador con Google ---
// El celular hace el login nativo con el SDK de Google
// (@react-native-google-signin/google-signin), obtiene un idToken, y lo
// manda aqui. El backend lo valida contra los servidores de Google (nunca
// confia en datos que vengan sueltos del celular) antes de emitir el token
// propio de la app. GOOGLE_CLIENT_ID es el "Client ID" de tipo Web creado en
// Google Cloud Console (ver CLAUDE.md, seccion de login con Google).
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

// Duracion de la prueba gratuita para un negocio nuevo que se registra solo
// con Google (mismo criterio que seed.js: 3 dias, plan 'basico').
const DIAS_PRUEBA_NEGOCIO_NUEVO = 3;

router.post("/admin/google", asyncHandler(async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) throw errorConEstado(400, "Falta el idToken de Google");
  if (!googleClient) throw errorConEstado(500, "El login con Google no está configurado en el servidor (falta GOOGLE_CLIENT_ID)");

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    throw errorConEstado(401, "Token de Google inválido");
  }
  if (!payload?.email) throw errorConEstado(401, "Google no devolvió un email válido");
  if (!payload.email_verified) throw errorConEstado(401, "Verifica tu email en Google antes de continuar");

  const email = payload.email;
  let negocio = db.prepare("SELECT * FROM negocios WHERE email = ?").get(email);

  // Primera vez que este email inicia sesion: se crea el negocio y su admin
  // automaticamente (Google hace de login Y de registro a la vez, no hay
  // formulario de "crear cuenta" aparte). Arranca igual que un negocio de
  // seed.js: plan 'basico', 3 dias de prueba, sin ninguna sede todavia (el
  // admin pasa por "crea tu primera sede" como cualquier cliente nuevo).
  if (!negocio) {
    const negocioId = uuid();
    const adminId = uuid();
    const hoy = new Date();
    const finPrueba = new Date(hoy.getTime() + DIAS_PRUEBA_NEGOCIO_NUEVO * 24 * 60 * 60 * 1000);

    db.prepare(`
      INSERT INTO negocios (id, nombre_admin, email, password_hash, plan, suscripcion_activa, fecha_inicio_prueba, fecha_fin_prueba, fecha_expiracion_licencia)
      VALUES (?, ?, ?, NULL, 'basico', 1, ?, ?, ?)
    `).run(negocioId, payload.name || email, email, hoy.toISOString(), finPrueba.toISOString(), finPrueba.toISOString());

    db.prepare(`
      INSERT INTO usuarios (id, negocio_id, parqueadero_id, rol, nombre)
      VALUES (?, ?, NULL, 'admin', ?)
    `).run(adminId, negocioId, payload.name || email);

    negocio = db.prepare("SELECT * FROM negocios WHERE id = ?").get(negocioId);
  }

  const admin = db.prepare("SELECT * FROM usuarios WHERE negocio_id = ? AND rol = 'admin'").get(negocio.id);
  const token = firmarToken(admin);
  res.json({ token, negocio: { id: negocio.id, plan: negocio.plan, nombre: negocio.nombre_admin } });
}));

// --- Login del administrador con email/password ---
// Solo para pruebas locales (ver seed.js / la cuenta demo admin@demo.com).
// En produccion el admin real siempre entra por /admin/google de arriba.
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
