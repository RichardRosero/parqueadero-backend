// db.js
// Inicializa la base de datos SQLite local y crea el esquema si no existe.
// Usa el modulo nativo `node:sqlite` (incluido en Node desde la v22.5,
// estable desde la v24) en vez de un paquete externo como better-sqlite3,
// para no depender de compilacion nativa (evita el problema de Visual
// Studio Build Tools en Windows). Requiere Node 22 o superior.
//
// En produccion, la sincronizacion hacia una base "ligera en la nube"
// (seccion 9 del documento) se puede implementar reemplazando este archivo
// por un cliente de Postgres/Turso/Supabase sin tocar el resto del codigo,
// siempre que se respeten las mismas funciones exportadas.

const { DatabaseSync } = require("node:sqlite");
const path = require("path");

const db = new DatabaseSync(path.join(__dirname, "..", "parqueadero.db"));
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS negocios (
  id TEXT PRIMARY KEY,
  nombre_admin TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT, -- solo para pruebas locales; en produccion se reemplaza por login Google/Apple
  plan TEXT NOT NULL DEFAULT 'basico', -- basico | intermedio | ilimitado | empresarial
  suscripcion_activa INTEGER NOT NULL DEFAULT 1,
  fecha_inicio_prueba TEXT NOT NULL,
  fecha_fin_prueba TEXT NOT NULL,
  fecha_expiracion_licencia TEXT,
  periodo_gracia_horas INTEGER NOT NULL DEFAULT 60, -- ver seccion 4 del documento
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS parqueaderos (
  id TEXT PRIMARY KEY,
  negocio_id TEXT NOT NULL REFERENCES negocios(id),
  codigo TEXT UNIQUE, -- codigo interno unico, generado por el servidor (no lo elige el usuario). Uso interno/reportes.
  nombre TEXT NOT NULL,
  moneda TEXT NOT NULL DEFAULT 'USD',
  codigo_region TEXT NOT NULL DEFAULT '+593',
  capacidad_maxima INTEGER,
  monto_recargo_whatsapp REAL NOT NULL DEFAULT 0.10,
  monto_recargo_sms REAL NOT NULL DEFAULT 0.10,
  webhook_pluma_url TEXT,
  tolerancia_vencimiento_horas REAL NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1, -- borrado logico: "eliminar sede" solo la desactiva, nunca se borran sus registros/reportes
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  negocio_id TEXT NOT NULL REFERENCES negocios(id),
  parqueadero_id TEXT REFERENCES parqueaderos(id), -- NULL para el admin (ve todas sus sedes)
  rol TEXT NOT NULL, -- 'admin' | 'guardia'
  nombre TEXT NOT NULL,
  usuario TEXT UNIQUE, -- login interno del guardia
  pin_hash TEXT, -- PIN del guardia (hasheado)
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sedes asignadas a un operador (rol 'guardia'): un operador puede cubrir
-- una o mas sedes del mismo negocio (el admin las elige al crearlo/editarlo).
CREATE TABLE IF NOT EXISTS usuarios_sedes (
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  parqueadero_id TEXT NOT NULL REFERENCES parqueaderos(id),
  PRIMARY KEY (usuario_id, parqueadero_id)
);

CREATE TABLE IF NOT EXISTS tipos_vehiculo (
  id TEXT PRIMARY KEY,
  parqueadero_id TEXT NOT NULL REFERENCES parqueaderos(id),
  nombre TEXT NOT NULL, -- moto | liviano | pesado | ...
  tarifa_hora REAL NOT NULL,
  tarifa_fraccion REAL NOT NULL,
  duracion_fraccion_minutos INTEGER NOT NULL DEFAULT 15
);

CREATE TABLE IF NOT EXISTS vehiculos (
  id TEXT PRIMARY KEY,
  parqueadero_id TEXT NOT NULL REFERENCES parqueaderos(id),
  placa TEXT NOT NULL,
  tipo_vehiculo_id TEXT REFERENCES tipos_vehiculo(id),
  plan_interno_activo INTEGER NOT NULL DEFAULT 0,
  plan_interno_valor REAL,
  plan_interno_vence TEXT,
  bloqueado INTEGER NOT NULL DEFAULT 0,
  UNIQUE(parqueadero_id, placa)
);

CREATE TABLE IF NOT EXISTS registros (
  id TEXT PRIMARY KEY,
  parqueadero_id TEXT NOT NULL REFERENCES parqueaderos(id),
  placa TEXT NOT NULL,
  tipo_vehiculo_id TEXT REFERENCES tipos_vehiculo(id),
  guardia_entrada_id TEXT REFERENCES usuarios(id),
  guardia_salida_id TEXT REFERENCES usuarios(id),
  codigo TEXT NOT NULL,
  hora_entrada TEXT NOT NULL,
  hora_salida TEXT,
  valor_parqueo REAL,
  recargo_notificacion REAL NOT NULL DEFAULT 0,
  metodo_notificacion_entrada TEXT, -- whatsapp | telegram | sms | impresion | ninguno/NULL: como se le entrego el ticket al entrar
  metodo_notificacion_salida TEXT, -- whatsapp | telegram | sms | impresion | ninguno: como se le notifico el valor a pagar al salir
  estado TEXT NOT NULL DEFAULT 'activo', -- activo | cerrado
  sincronizado INTEGER NOT NULL DEFAULT 1 -- usado por el cliente offline, ver mobile/offlineQueue.js
);

CREATE TABLE IF NOT EXISTS panico_log (
  id TEXT PRIMARY KEY,
  parqueadero_id TEXT NOT NULL REFERENCES parqueaderos(id),
  guardia_id TEXT NOT NULL REFERENCES usuarios(id),
  codigo_ingresado TEXT NOT NULL,
  motivo TEXT NOT NULL,
  placa TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  -- Nota: esta tabla es de solo insercion. No se exponen rutas UPDATE/DELETE
  -- para cumplir con el requisito de auditoria inmutable (seccion 12).
);

CREATE INDEX IF NOT EXISTS idx_registros_parqueadero ON registros(parqueadero_id, estado);
CREATE INDEX IF NOT EXISTS idx_vehiculos_placa ON vehiculos(parqueadero_id, placa);
`);

// Migracion ligera: si la tabla parqueaderos ya existia de antes de agregar
// las columnas `codigo`/`activo`, las agregamos ahora. CREATE TABLE IF NOT
// EXISTS no modifica tablas ya creadas, y ALTER TABLE no permite agregar una
// restriccion UNIQUE directamente sobre la columna, asi que la unicidad se
// aplica con indices unicos aparte (funcionan igual en tablas nuevas o viejas).
const columnas = db.prepare("PRAGMA table_info(parqueaderos)").all();
if (!columnas.some((c) => c.name === "codigo")) {
  db.exec("ALTER TABLE parqueaderos ADD COLUMN codigo TEXT;");
}
if (!columnas.some((c) => c.name === "activo")) {
  db.exec("ALTER TABLE parqueaderos ADD COLUMN activo INTEGER NOT NULL DEFAULT 1;");
}
// Multa configurable por sede para la salida de emergencia (boton de panico)
// cuando el motivo es "perdida de ticket/celular del cliente", ver
// routes/panico.js. 0 = sin multa (comportamiento anterior).
if (!columnas.some((c) => c.name === "monto_multa_perdida_ticket")) {
  db.exec("ALTER TABLE parqueaderos ADD COLUMN monto_multa_perdida_ticket REAL NOT NULL DEFAULT 0;");
}
// El campo "metodo_notificacion" original solo guardaba el metodo de la
// SALIDA (y encima nunca se llenaba el de la entrada). Se separa en dos
// columnas para poder ver con que metodo se entrego el ticket al entrar y
// con cual se notifico el valor a pagar al salir, cada uno por su lado.
const columnasRegistros = db.prepare("PRAGMA table_info(registros)").all();
if (columnasRegistros.some((c) => c.name === "metodo_notificacion") && !columnasRegistros.some((c) => c.name === "metodo_notificacion_salida")) {
  db.exec("ALTER TABLE registros RENAME COLUMN metodo_notificacion TO metodo_notificacion_salida;");
}
if (!db.prepare("PRAGMA table_info(registros)").all().some((c) => c.name === "metodo_notificacion_entrada")) {
  db.exec("ALTER TABLE registros ADD COLUMN metodo_notificacion_entrada TEXT;");
}

db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_parqueaderos_codigo ON parqueaderos(codigo);");
// Unico entre las sedes ACTIVAS de un negocio: al "eliminar" (desactivar)
// una sede, su nombre queda libre para reutilizarse.
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_parqueaderos_negocio_nombre ON parqueaderos(negocio_id, nombre) WHERE activo = 1;");

module.exports = db;
