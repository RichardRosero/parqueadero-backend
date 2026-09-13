// middleware/auth.js
const jwt = require("jsonwebtoken");
const db = require("../db");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-cambiar-en-produccion";

function firmarToken(usuario) {
  return jwt.sign(
    { id: usuario.id, negocioId: usuario.negocio_id, parqueaderoId: usuario.parqueadero_id, rol: usuario.rol },
    JWT_SECRET,
    { expiresIn: "12h" }
  );
}

function requiereAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "Falta token de autenticacion" });
  try {
    req.usuario = jwt.verify(header.replace("Bearer ", ""), JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Token invalido o expirado" });
  }
}

function requiereRol(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.usuario.rol)) {
      return res.status(403).json({ error: "No tienes permiso para esta accion" });
    }
    next();
  };
}

// Valida que la licencia del negocio este activa, respetando el periodo de
// gracia offline definido en la seccion 4 del documento. El cliente movil
// hace esta misma validacion localmente cuando no hay internet; este
// endpoint es la fuente de verdad cuando SI hay conexion.
function validarLicencia(req, res, next) {
  const negocio = db.prepare("SELECT * FROM negocios WHERE id = ?").get(req.usuario.negocioId);
  if (!negocio) return res.status(404).json({ error: "Negocio no encontrado" });

  const ahora = new Date();
  const expiracion = new Date(negocio.fecha_expiracion_licencia);
  const finGracia = new Date(expiracion.getTime() + negocio.periodo_gracia_horas * 60 * 60 * 1000);

  if (!negocio.suscripcion_activa && ahora > finGracia) {
    return res.status(402).json({
      error: "Suscripcion vencida",
      accion: "mostrar_pantalla_de_planes",
    });
  }

  req.negocio = negocio;
  next();
}

module.exports = { firmarToken, requiereAuth, requiereRol, validarLicencia, JWT_SECRET };
