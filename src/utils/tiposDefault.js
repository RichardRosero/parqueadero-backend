// tiposDefault.js — los 3 tipos de vehiculo con los que arranca toda sede
// nueva (seccion 5 del documento). El admin puede editar sus tarifas
// libremente y agregar hasta MAX_TIPOS_EXTRA tipos adicionales propios
// (ver el limite aplicado en routes/vehiculos.js).
const TIPOS_DEFAULT = [
  { nombre: "Moto", tarifa_hora: 0.5, tarifa_fraccion: 0.2 },
  { nombre: "Auto-Camioneta", tarifa_hora: 1.0, tarifa_fraccion: 0.35 },
  { nombre: "Vehículo Pesado", tarifa_hora: 2.0, tarifa_fraccion: 0.6 },
];

const MAX_TIPOS_EXTRA = 2;
const MAX_TIPOS_TOTAL = TIPOS_DEFAULT.length + MAX_TIPOS_EXTRA;

module.exports = { TIPOS_DEFAULT, MAX_TIPOS_EXTRA, MAX_TIPOS_TOTAL };
