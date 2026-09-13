// codigo.js — genera el codigo numerico + QR unico de cada registro (seccion 7)
const QRCode = require("qrcode");
const crypto = require("crypto");

function generarCodigoNumerico() {
  return crypto.randomInt(100000, 999999).toString();
}

async function generarQrDataUrl(payload) {
  return QRCode.toDataURL(JSON.stringify(payload));
}

// A diferencia de generarQrDataUrl (que codifica un objeto JSON para uso
// interno de la app), este codifica texto plano — se usa para el link de
// Telegram, asi cualquier camara/lector de QR normal tambien lo puede leer,
// no solo esta app.
async function generarQrDataUrlTexto(texto) {
  return QRCode.toDataURL(texto);
}

// Codigo interno unico por sede (ver routes/parqueaderos.js). No lo elige
// el usuario; sirve para reportes/soporte del lado del desarrollador.
function generarCodigoSede() {
  return `PRQ-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

module.exports = { generarCodigoNumerico, generarQrDataUrl, generarQrDataUrlTexto, generarCodigoSede };
