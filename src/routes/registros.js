// routes/registros.js — seccion 7: entrada/salida, notificacion y cobro por envio
const express = require("express");
const { v4: uuid } = require("uuid");
const db = require("../db");
const { requiereAuth, validarLicencia } = require("../middleware/auth");
const { calcularValorAPagar } = require("../services/tarifaEngine");
const { enviarNotificacion } = require("../services/notificaciones");
// Nota: abrirPluma (services/webhookPluma.js) ya no se llama desde aqui — el
// cierre del registro (boton "Salir") queda separado de abrir la pluma, que
// sera un boton aparte reservado a ciertos planes (ver conversacion).
const { generarCodigoNumerico, generarQrDataUrl, generarQrDataUrlTexto } = require("../utils/codigo");
const asyncHandler = require("../utils/asyncHandler");
const { errorConEstado } = require("../utils/errores");

const router = express.Router();
router.use(requiereAuth, validarLicencia);

// --- Registrar entrada ---
router.post("/entrada", asyncHandler(async (req, res) => {
  const { parqueadero_id, placa, tipo_vehiculo_id, metodo_notificacion, destino_notificacion } = req.body;

  if (!parqueadero_id) throw errorConEstado(400, "Falta seleccionar la sede (parqueadero_id)");
  if (!placa) throw errorConEstado(400, "Falta la placa");

  const parqueaderoExiste = db.prepare("SELECT id FROM parqueaderos WHERE id = ?").get(parqueadero_id);
  if (!parqueaderoExiste) throw errorConEstado(400, "La sede indicada no existe");

  if (tipo_vehiculo_id) {
    const tipoExiste = db.prepare("SELECT id FROM tipos_vehiculo WHERE id = ? AND parqueadero_id = ?").get(tipo_vehiculo_id, parqueadero_id);
    if (!tipoExiste) throw errorConEstado(400, "El tipo de vehiculo indicado no existe en esta sede");
  }

  const id = uuid();
  const codigo = generarCodigoNumerico();
  const horaEntrada = new Date().toISOString();

  db.prepare(`
    INSERT INTO registros (id, parqueadero_id, placa, tipo_vehiculo_id, guardia_entrada_id, codigo, hora_entrada, estado, metodo_notificacion_entrada)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'activo', ?)
  `).run(id, parqueadero_id, placa.toUpperCase(), tipo_vehiculo_id || null, req.usuario.id, codigo, horaEntrada, metodo_notificacion || null);

  const qrDataUrl = await generarQrDataUrl({ registroId: id, codigo });

  let notificacion = null;
  if (metodo_notificacion && metodo_notificacion !== "ninguno") {
    const parqueadero = db.prepare("SELECT * FROM parqueaderos WHERE id = ?").get(parqueadero_id);
    notificacion = await enviarNotificacion(
      metodo_notificacion,
      destino_notificacion,
      { codigo, qrDataUrl, mensaje: `Tu codigo de salida es ${codigo}. Guardalo para retirar tu vehiculo.` },
      { montoRecargoWhatsapp: parqueadero.monto_recargo_whatsapp, montoRecargoSms: parqueadero.monto_recargo_sms }
    );
    // Para Telegram se muestra un QR con el link (no un texto), asi el
    // cliente lo escanea con la camara del celular del guardia.
    if (notificacion.linkTelegram) {
      notificacion.qrTelegram = await generarQrDataUrlTexto(notificacion.linkTelegram);
    }
  }

  res.status(201).json({ id, codigo, qrDataUrl, notificacion });
}));

// Busca el registro activo por placa (lo que el guardia tiene a mano, no el
// id interno del registro) y valida el codigo del ticket. Se comparte entre
// /salida/calcular y /salida/confirmar para no duplicar la validacion.
function buscarRegistroActivoValidado(parqueadero_id, placa, codigo) {
  if (!parqueadero_id || !placa || !codigo) throw errorConEstado(400, "Faltan parqueadero_id, placa y/o codigo");

  const registro = db.prepare(`
    SELECT * FROM registros WHERE parqueadero_id = ? AND placa = ? AND estado = 'activo'
    ORDER BY hora_entrada DESC LIMIT 1
  `).get(parqueadero_id, placa.toUpperCase());
  if (!registro) throw errorConEstado(404, "No hay un registro activo para esa placa en esta sede");
  if (registro.codigo !== codigo) throw errorConEstado(400, "Codigo incorrecto");

  const parqueadero = db.prepare("SELECT * FROM parqueaderos WHERE id = ?").get(registro.parqueadero_id);
  const tipoVehiculo = db.prepare("SELECT * FROM tipos_vehiculo WHERE id = ?").get(registro.tipo_vehiculo_id);
  if (!tipoVehiculo) {
    throw errorConEstado(400, "Este vehiculo no tiene un tipo/tarifa asignada. Asignalo antes de calcular la salida.");
  }
  const vehiculo = db.prepare("SELECT * FROM vehiculos WHERE parqueadero_id = ? AND placa = ?").get(registro.parqueadero_id, registro.placa);

  return { registro, parqueadero, tipoVehiculo, vehiculo };
}

// --- Calcular el valor a pagar de una salida (seccion 7) ---
// Solo consulta y calcula: NO cierra el registro ni abre la pluma. El
// operador ve el tiempo/valor aqui, cobra por fuera de la app (efectivo,
// transferencia, etc.) y solo despues confirma con /salida/confirmar
// (boton "Salir"). Abrir la pluma automaticamente es una funcion aparte
// para mas adelante (reservada a ciertos planes), no ocurre en este flujo.
router.post("/salida/calcular", asyncHandler(async (req, res) => {
  const { parqueadero_id, placa, codigo, decision_guardia } = req.body;
  const { registro, parqueadero, tipoVehiculo, vehiculo } = buscarRegistroActivoValidado(parqueadero_id, placa, codigo);

  const horaEntrada = new Date(registro.hora_entrada);
  const horaSalida = new Date();
  const { valor, detalle } = calcularValorAPagar({
    horaEntrada,
    horaSalida,
    tipoVehiculo,
    vehiculo,
    toleranciaHoras: parqueadero.tolerancia_vencimiento_horas,
    decisionGuardia: decision_guardia, // 'vencimiento' | 'tolerancia', solo aplica si vencio a mitad de estadia
  });

  res.json({
    valor,
    detalle,
    recargo: 0,
    total: round2(valor),
    horaEntrada: horaEntrada.toISOString(),
    horaSalida: horaSalida.toISOString(),
    minutosTotales: Math.round((horaSalida - horaEntrada) / 60000),
  });
}));

// --- Confirmar la salida (boton "Salir") ---
// Se llama despues de que el operador ya cobro por fuera de la app. Cierra
// el registro con el valor calculado en este momento (se recalcula por si
// paso tiempo entre "Calcular" y "Salir").
router.post("/salida/confirmar", asyncHandler(async (req, res) => {
  const { parqueadero_id, placa, codigo, decision_guardia, metodo_notificacion_ticket, destino_notificacion } = req.body;
  const { registro, parqueadero, tipoVehiculo, vehiculo } = buscarRegistroActivoValidado(parqueadero_id, placa, codigo);

  const horaEntrada = new Date(registro.hora_entrada);
  const horaSalida = new Date();
  const { valor, detalle } = calcularValorAPagar({
    horaEntrada,
    horaSalida,
    tipoVehiculo,
    vehiculo,
    toleranciaHoras: parqueadero.tolerancia_vencimiento_horas,
    decisionGuardia: decision_guardia,
  });

  let recargo = 0;
  let notificacion = null;
  if (metodo_notificacion_ticket && metodo_notificacion_ticket !== "ninguno") {
    notificacion = await enviarNotificacion(
      metodo_notificacion_ticket,
      destino_notificacion,
      { codigo, mensaje: `Tiempo de estancia y valor a pagar: $${valor} (${detalle}).` },
      { montoRecargoWhatsapp: parqueadero.monto_recargo_whatsapp, montoRecargoSms: parqueadero.monto_recargo_sms }
    );
    recargo = notificacion.recargo;
    // Igual que en /entrada: el bot de Telegram no puede escribirle primero
    // al cliente, asi que se muestra un QR para que lo escanee y el mensaje
    // de salida (tiempo/valor) se lo manda telegramPoller.js cuando llegue
    // ese /start (ver ahi como decide si es ticket de entrada o de salida).
    if (notificacion.linkTelegram) {
      notificacion.qrTelegram = await generarQrDataUrlTexto(notificacion.linkTelegram);
    }
  }

  db.prepare(`
    UPDATE registros
    SET hora_salida = ?, valor_parqueo = ?, recargo_notificacion = ?, metodo_notificacion_salida = ?, guardia_salida_id = ?, estado = 'cerrado'
    WHERE id = ?
  `).run(horaSalida.toISOString(), valor, recargo, metodo_notificacion_ticket || null, req.usuario.id, registro.id);

  res.json({
    valor,
    detalle,
    recargo,
    total: round2(valor + recargo),
    horaEntrada: horaEntrada.toISOString(),
    horaSalida: horaSalida.toISOString(),
    minutosTotales: Math.round((horaSalida - horaEntrada) / 60000),
    notificacion,
  });
}));

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = router;
