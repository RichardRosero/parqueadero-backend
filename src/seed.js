// seed.js — crea datos de demostracion para probar la app localmente.
// Ejecutar con: npm run seed
// Por defecto crea solo el negocio + admin, SIN ninguna sede: asi se
// reproduce exactamente lo que ve un cliente nuevo real, que debe pasar por
// el flujo de "crear tu primera sede" (ver ConfiguracionScreen.js). Para
// tener ademas una sede + guardia de prueba lista (util para probar
// entrada/salida/reportes sin tener que crear todo a mano), usar:
//   npm run seed:completo

const { v4: uuid } = require("uuid");
const bcrypt = require("bcryptjs");
const db = require("./db");
const { TIPOS_DEFAULT } = require("./utils/tiposDefault");
const { generarCodigoSede } = require("./utils/codigo");

function seed() {
  const conSede = process.argv.includes("--con-sede");

  const negocioId = uuid();
  const adminId = uuid();

  const hoy = new Date();
  const finPrueba = new Date(hoy.getTime() + 3 * 24 * 60 * 60 * 1000);

  // Plan 'empresarial' en la cuenta demo (no 'basico') para poder probar
  // libremente el flujo de multi-sede sin toparse con el limite de 1 sola
  // sede. Para probar ese limite especificamente, cambia el plan a mano.
  db.prepare(`
    INSERT INTO negocios (id, nombre_admin, email, password_hash, plan, suscripcion_activa, fecha_inicio_prueba, fecha_fin_prueba, fecha_expiracion_licencia)
    VALUES (?, ?, ?, ?, 'empresarial', 1, ?, ?, ?)
  `).run(negocioId, "Admin Demo", "admin@demo.com", bcrypt.hashSync("demo1234", 8), hoy.toISOString(), finPrueba.toISOString(), finPrueba.toISOString());

  db.prepare(`
    INSERT INTO usuarios (id, negocio_id, parqueadero_id, rol, nombre, usuario)
    VALUES (?, ?, NULL, 'admin', 'Admin Demo', 'admin')
  `).run(adminId, negocioId);

  console.log("Datos de prueba creados:");
  console.log("  Admin  -> usuario: admin@demo.com  password: demo1234");

  if (!conSede) {
    console.log("  (sin sedes: al iniciar sesion como admin se pide crear la primera)");
    return;
  }

  const parqueaderoId = uuid();
  const guardiaId = uuid();

  db.prepare(`
    INSERT INTO parqueaderos (id, negocio_id, codigo, nombre, moneda, codigo_region, capacidad_maxima)
    VALUES (?, ?, ?, 'Parqueadero Central', 'USD', '+593', 50)
  `).run(parqueaderoId, negocioId, generarCodigoSede());

  db.prepare(`
    INSERT INTO usuarios (id, negocio_id, parqueadero_id, rol, nombre, usuario, pin_hash)
    VALUES (?, ?, ?, 'guardia', 'Guardia Demo', 'guardia1', ?)
  `).run(guardiaId, negocioId, parqueaderoId, bcrypt.hashSync("1234", 8));

  for (const t of TIPOS_DEFAULT) {
    db.prepare(`
      INSERT INTO tipos_vehiculo (id, parqueadero_id, nombre, tarifa_hora, tarifa_fraccion)
      VALUES (?, ?, ?, ?, ?)
    `).run(uuid(), parqueaderoId, t.nombre, t.tarifa_hora, t.tarifa_fraccion);
  }

  console.log("  Guardia -> usuario: guardia1        PIN: 1234");
  console.log("  Parqueadero:", parqueaderoId);
}

seed();
