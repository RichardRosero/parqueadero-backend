// tarifaEngine.js
// Calcula el valor a pagar por un vehiculo al salir, y resuelve el caso de
// mensualidad vencida mientras el vehiculo estaba parqueado (seccion 5 del
// documento: "Expiracion de mensualidad con vehiculo dentro del parqueadero").

/**
 * @param {object} params
 * @param {Date} params.horaEntrada
 * @param {Date} params.horaSalida
 * @param {{tarifa_hora:number, tarifa_fraccion:number, duracion_fraccion_minutos:number}} params.tipoVehiculo
 * @param {{plan_interno_activo:number, plan_interno_vence:string|null}} [params.vehiculo]
 * @param {number} [params.toleranciaHoras] - configurada por el admin en el parqueadero
 * @param {"vencimiento"|"tolerancia"} [params.decisionGuardia] - si hay vencimiento a mitad de estadia,
 *   el guardia decide si se cobra desde el vencimiento exacto o se aplica la tolerancia configurada
 */
function calcularValorAPagar({ horaEntrada, horaSalida, tipoVehiculo, vehiculo, toleranciaHoras = 0, decisionGuardia }) {
  const msTotales = horaSalida - horaEntrada;
  if (msTotales < 0) throw new Error("La hora de salida no puede ser anterior a la de entrada");

  // Caso 1: vehiculo con mensualidad activa y vigente durante toda la estadia -> no se cobra por hora
  const vence = vehiculo?.plan_interno_vence ? new Date(vehiculo.plan_interno_vence) : null;
  if (vehiculo?.plan_interno_activo && vence && vence >= horaSalida) {
    return { valor: 0, detalle: "Cubierto por mensualidad vigente" };
  }

  // Caso 2: la mensualidad vencio EN MEDIO de la estadia -> se cobra por hora
  // solo desde el punto de corte (vencimiento exacto, o vencimiento + tolerancia)
  let desde = horaEntrada;
  if (vehiculo?.plan_interno_activo && vence && vence > horaEntrada && vence < horaSalida) {
    const puntoDeCorte = decisionGuardia === "tolerancia"
      ? new Date(vence.getTime() + toleranciaHoras * 60 * 60 * 1000)
      : vence;
    desde = puntoDeCorte > horaSalida ? horaSalida : puntoDeCorte;
  }

  const minutos = Math.max(0, (horaSalida - desde) / 60000);
  const { tarifa_hora, tarifa_fraccion, duracion_fraccion_minutos } = tipoVehiculo;

  if (minutos === 0) {
    return { valor: 0, detalle: "Cubierto por tolerancia" };
  }

  if (minutos <= duracion_fraccion_minutos) {
    return { valor: round2(tarifa_fraccion), detalle: "Cobro por fraccion" };
  }

  const horasCompletas = Math.floor(minutos / 60);
  const minutosRestantes = minutos % 60;
  let valor = horasCompletas * tarifa_hora;
  let detalle = `Cobro por ${horasCompletas}h`;
  if (minutosRestantes > 0) {
    valor += minutosRestantes <= duracion_fraccion_minutos ? tarifa_fraccion : tarifa_hora;
    detalle += " + fraccion";
  }

  return { valor: round2(valor), detalle };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { calcularValorAPagar };
