// services/notificaciones/index.js
// Punto unico de entrada para enviar el codigo/ticket al cliente, con la
// tabla de costos definida en la seccion 7 del documento.
//
// IMPORTANTE: whatsapp.js, telegram.js y sms.js estan en modo "stub" (solo
// registran en consola lo que enviarian). Para activarlos de verdad hay que
// completar las credenciales del archivo .env (ver .env.example) y
// descomentar las llamadas reales dentro de cada archivo.

const whatsapp = require("./whatsapp");
const telegram = require("./telegram");
const sms = require("./sms");
const imprimir = require("./imprimir");

const METODOS_GRATIS = new Set(["telegram", "impresion"]);

/**
 * @param {"whatsapp"|"telegram"|"sms"|"impresion"} metodo
 * @param {string} destino - numero de telefono o identificador segun el metodo
 * @param {{codigo:string, qrDataUrl?:string, mensaje:string}} contenido
 * @param {{montoRecargoWhatsapp:number, montoRecargoSms:number}} config - viene de la tabla `parqueaderos`
 * @returns {Promise<{enviado:boolean, recargo:number}>}
 */
async function enviarNotificacion(metodo, destino, contenido, config) {
  let recargo = 0;
  let linkTelegram = null;

  switch (metodo) {
    case "whatsapp":
      await whatsapp.enviar(destino, contenido);
      recargo = config.montoRecargoWhatsapp ?? 0;
      break;
    case "telegram":
      // No se manda nada todavia: un bot no puede escribirle primero a
      // nadie. Se genera el link para que el cliente toque "Iniciar" en
      // Telegram; el mensaje real lo manda services/telegramPoller.js
      // cuando eso pase.
      linkTelegram = await telegram.construirLink(contenido.codigo);
      break;
    case "sms":
      await sms.enviar(destino, contenido);
      recargo = config.montoRecargoSms ?? 0;
      break;
    case "impresion":
      await imprimir.imprimir(contenido);
      break;
    default:
      throw new Error(`Metodo de notificacion desconocido: ${metodo}`);
  }

  return { enviado: metodo !== "telegram", recargo, esGratis: METODOS_GRATIS.has(metodo), linkTelegram };
}

module.exports = { enviarNotificacion };
