const express = require("express");
const session = require("express-session");
const mysql = require('mysql2/promise');
const { engine } = require("express-handlebars");
const multer = require('multer');
const fs = require('fs');

const path = require('path');
const app = express();
app.set("port", process.env.PORT || 3000);
// Configure view engine
app.set("views", __dirname + "/views");
app.engine(".hbs", engine({ extname: ".hbs" }));  // Configura Handlebars como motor de vistas
app.set("view engine", "hbs");

const Handlebars = require('handlebars');
// Registrar el helper 'not'
Handlebars.registerHelper('not', function (value) {
    return !value;
});
app.use(express.json());  // Middleware para parsear JSON en las solicitudes
app.use(express.urlencoded({ extended: true }));  // Middleware para parsear URL-encoded en las solicitudes
app.use(express.static(__dirname + '/public'));  // Middleware para servir archivos estáticos desde el directorio 'public'




// Crea un pool de conexiones
const pool = mysql.createPool({
    host: '127.0.0.1',
    user: 'root',
    password: '',
    database: 'recursos_humanos',
    waitForConnections: true,
    connectionLimit: 10, // Número máximo de conexiones en el pool
    queueLimit: 0 // Número máximo de solicitudes en cola (0 = ilimitado)
});

// Exporta el pool para usarlo en otros módulos
module.exports = pool;

// Middleware para pasar una conexión del pool a cada objeto de solicitud
app.use(async (req, res, next) => {
    try {
        req.db = await pool.getConnection();
        res.on('finish', () => {
            req.db.release();
        });
        next();
    } catch (err) {
        next(err);
    }
});







// Session middleware
app.use(session({
    secret: "secret",  // Clave secreta para firmar la cookie de sesión
    resave: true,  // Forzar a que la sesión se guarde de nuevo en el almacenamiento de sesiones
    saveUninitialized: true  // Forzar a que una sesión se guarde, aunque no haya datos para almacenar
}));






// Render login form
app.get("/login", (req, res) => {
    if (req.session.loggedin) {
        res.redirect("/");  // Redirigir a la página principal si ya está autenticado
    } else {
        res.render("login/index.hbs", { error: null });  // Renderizar el formulario de inicio de sesión con un mensaje de error nulo
    }
});





// Handle login authentication
app.post("/auth", async (req, res) => {
    const data = req.body;
    const connection = req.db;

    try {
        const [userData] = await connection.query("SELECT * FROM user WHERE email = ? AND password = ?", [data.email, data.password]);

        if (userData.length > 0) {
            const user = userData[0];
            req.session.loggedin = true;  // Establecer sesión como autenticada
            req.session.name = user.name;  // Guardar nombre de usuario en la sesión
            req.session.roles = typeof user.roles === 'string' ? user.roles.split(',') : [];  // Guardar roles del usuario en la sesión

            res.redirect("/");  // Redirigir a la página principal después del inicio de sesión exitoso
        } else {
            // Renderizar página de inicio de sesión con mensaje de error
            res.render("login/index.hbs", { error: "Usuario no encontrado o contraseña incorrecta" });
        }
    } catch (err) {
        console.error("Error fetching user from database:", err);  // Manejar errores al recuperar datos del usuario desde la base de datos
        res.status(500).send("Internal Server Error");  // Enviar respuesta de error interno del servidor
    }
});


// Render register form
app.get("/register", (req, res) => {
    if (req.session.loggedin) {
        res.redirect("/");  // Redirigir a la página principal si ya está autenticado
    } else {
        res.render("login/register.hbs", { error: null });  // Renderizar el formulario de registro con mensaje de error nulo
    }
});




// Handle user registration
app.post("/storeUser", async (req, res) => {
    const data = req.body;
    const connection = req.db;

    try {
        const [userData] = await connection.query("SELECT * FROM user WHERE email = ?", [data.email]);

        if (userData.length > 0) {
            res.render("login/register.hbs", { error: "User with this email already exists" });  // Renderizar página de registro con mensaje de usuario ya existente
            return;
        }

        await connection.query("INSERT INTO user SET ?", data);
        console.log("User registered successfully");  // Registrar registro exitoso del usuario
        res.redirect("/");  // Redirigir a la página principal después del registro exitoso
    } catch (err) {
        console.error("Error handling user registration:", err);  // Manejar errores durante el registro del usuario
        res.status(500).send("Internal Server Error");  // Enviar respuesta de error interno del servidor
    }
});





// Handle logout
app.get("/logout", (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error("Error destroying session:", err);  // Manejar errores al destruir la sesión
            res.status(500).send("Internal Server Error");  // Enviar respuesta de error interno del servidor
        } else {
            res.redirect("/login");  // Redirigir a la página de inicio de sesión después de cerrar sesión
        }
    });
});

// Middleware to protect routes that require authentication
function requireLogin(req, res, next) {
    if (req.session.loggedin) {
        next();  // Pasar al siguiente middleware si está autenticado
    } else {
        res.redirect("/login");  // Redirigir a la página de inicio de sesión si no está autenticado
    }
}



const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid'); // Utiliza UUID para generar IDs únicos

// Configurar el transporter con nodemailer
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'nexus.innovationss@gmail.com', // Coloca tu correo electrónico
        pass: 'dhmtnkcehxzfwzbd' // Coloca tu contraseña de correo electrónico
    },
    messageId: uuidv4(), // Genera un Message-ID único para cada correo enviado
});

const crypto = require('crypto'); // Importa el módulo crypto

// Handle forgot password
app.post("/forgot-password", async (req, res) => {
    const { email } = req.body;
    const connection = req.db;

    // Generar un token único y establecer la fecha de expiración
    const resetToken = crypto.randomBytes(20).toString('hex');
    const resetTokenExpiration = new Date();
    resetTokenExpiration.setHours(resetTokenExpiration.getHours() + 1); // Token válido por 1 hora

    try {
        const [result] = await connection.query(
            "UPDATE user SET resetToken = ?, resetTokenExpiration = ? WHERE email = ?",
            [resetToken, resetTokenExpiration, email]
        );

        // Check if user with provided email exists
        if (result.affectedRows === 0) {
            res.render("login/index.hbs", { error: "Correo electrónico no encontrado" });
        } else {
            const mailOptions = {
                from: 'nexus.innovationss@gmail.com',
                to: email,
                subject: 'Recuperación de Contraseña',
                html: `
                    <p>Hola,</p>
                    <p>Haz clic en el siguiente enlace para restablecer tu contraseña:</p>
                    <a href="http://localhost:3000/reset-password?token=${resetToken}">Restablecer Contraseña</a>
                    <p>Este enlace expirará en 1 hora.</p>
                    <p>Si no solicitaste esto, por favor ignora este correo y tu contraseña permanecerá sin cambios.</p>
                `
            };

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    console.error("Error sending email:", error);
                    res.status(500).send("Error al enviar el correo electrónico");
                } else {
                    console.log("Email sent:", info.response);
                    res.render("login/index.hbs", { successMessage: "Se ha enviado un correo electrónico con instrucciones para restablecer la contraseña" });
                }
            });
        }
    } catch (err) {
        console.error("Error updating reset token in database:", err);
        res.status(500).send("Internal Server Error");
    }
});



// Página para restablecer la contraseña (GET)
app.get("/reset-password", async (req, res) => {
    const token = req.query.token; // Obtiene el token de la consulta
    console.log("Token recibido en GET:", token);

    try {
        const connection = req.db;

        // Verificar si el token es válido y está dentro del tiempo de expiración adecuado
        const [results] = await connection.query(
            "SELECT * FROM user WHERE resetToken = ? AND resetTokenExpiration > NOW()",
            [token]
        );

        if (results.length === 0) {
            res.status(400).send("El token para restablecer la contraseña es inválido o ha expirado");
        } else {
            // Mostrar el formulario para restablecer la contraseña
            res.render("login/reset-password.hbs", { token });
        }
    } catch (err) {
        console.error("Error al verificar el token:", err);
        res.status(500).send("Error interno al verificar el token");
    }
});







// Procesar restablecimiento de contraseña (POST)
app.post("/reset-password", async (req, res) => {
    const { token, password } = req.body;

    try {
        const connection = req.db;

        // Verificar si el token es válido y está dentro del tiempo de expiración adecuado
        const [results] = await connection.query(
            "SELECT * FROM user WHERE resetToken = ? AND resetTokenExpiration > NOW()",
            [token]
        );

        if (results.length === 0) {
            res.status(400).send("El token para restablecer la contraseña es inválido o ha expirado");
        } else {
            const user = results[0];

            // Actualizar la contraseña en la base de datos y limpiar el token
            await connection.query(
                "UPDATE user SET password = ?, resetToken = NULL, resetTokenExpiration = NULL WHERE id = ?",
                [password, user.id]
            );

            console.log("Contraseña actualizada exitosamente para el usuario:", user.email);

            // Redirigir al usuario a la página de inicio de sesión con un mensaje de éxito
            res.render("login/index.hbs", { successMessage: "Contraseña restablecida exitosamente" });
        }
    } catch (err) {
        console.error("Error al procesar el restablecimiento de la contraseña:", err);
        res.status(500).send("Error interno al procesar el restablecimiento de la contraseña");
    }
});








// Ruta para la página principal 
app.get("/", (req, res) => {
    if (req.session.loggedin === true) {
        const nombreUsuario = req.session.name;
        console.log(`El usuario ${nombreUsuario} está autenticado.`);
        req.session.nombreGuardado = nombreUsuario; // Guarda el nombre en la sesión

        const rolesString = req.session.roles;
        const roles = Array.isArray(rolesString) ? rolesString : [];



        const administrativo = roles.includes('administrativo');
        const empleado = roles.includes('empleado');
 

        res.render("EMPRESA/home.hbs",{ name: req.session.name,administrativo,empleado }); // Pasar los roles a la plantilla
    } else {
        res.redirect("/login");
    }
});



//ruta para ingresar nuevos usuarios

app.get('/nuevoUsuario', (req, res) => {
    if (req.session.loggedin === true) {
        const nombreUsuario = req.session.name;
        res.render('nuevosUsuarios/ingresarNuevo_usuario.hbs', { nombreUsuario });
    } else {
        // Manejo para el caso en que el usuario no está autenticado
        res.redirect("/login");
    }
});

// Ruta para guardar un nuevo empleado
app.post('/guardarEmpleado', async (req, res) => {
    const { nombre, apellido, tipo, email, documento, sexo, telefono, direccion, fechaNacimiento, rol } = req.body;
    const connection = req.db;

    try {
        // Verificar si el email ya está registrado
        const sqlCheckEmail = 'SELECT COUNT(*) AS count FROM empleados WHERE email = ?';
        const [results] = await connection.query(sqlCheckEmail, [email]);

        const count = results[0].count;
        if (count > 0) {
            // El correo electrónico ya está registrado
            return res.status(400).render('nuevosUsuarios/ingresarNuevo_usuario.hbs', {
                error: 'El correo electrónico ya está registrado. Intente con otro correo.'
            });
        }

        // Si el correo no está registrado, proceder con la inserción
        const clave = generarClaveAleatoria(8); // Generar clave aleatoria
        const nuevoEmpleado = {
            nombre,
            apellido,
            email,
            tipo,
            documento,
            sexo,
            telefono,
            direccion,
            fechaNacimiento,
            rol
        };

        const sqlEmpleado = 'INSERT INTO empleados SET ?';
        const sqlUser = 'INSERT INTO user (name, email, password) VALUES (?, ?, ?)';

        await connection.beginTransaction();

        // Insertar en la tabla empleados
        const [resultEmpleado] = await connection.query(sqlEmpleado, nuevoEmpleado);
        console.log('Nuevo empleado creado en la tabla "empleados":', resultEmpleado.insertId);

        // Insertar en la tabla users
        const [resultUser] = await connection.query(sqlUser, [nombre, email, clave]);
        console.log('Nuevo usuario creado en la tabla "users":', resultUser.insertId);

        // Commit la transacción si todo fue exitoso
        await connection.commit();
        console.log('Transacción completada, empleado y usuario creados correctamente.');

        // Envío de correo electrónico al empleado con la clave
        enviarCorreo(email, nombre, clave);

        // Redirigir al usuario a la página de nuevo usuario
        res.redirect('/nuevoUsuario');
    } catch (err) {
        console.error('Error al guardar el empleado:', err);
        await connection.rollback();
        res.status(500).send('Error interno al guardar el empleado');
    }
});



// Función para generar clave aleatoria
function generarClaveAleatoria(length) {
    return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}


// Función para enviar correo electrónico
function enviarCorreo(email, nombre, clave) {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: 'nexus.innovationss@gmail.com', // Coloca tu correo electrónico
            pass: 'dhmtnkcehxzfwzbd' // Coloca tu contraseña de correo electrónico
        },
    });

    const mailOptions = {
        from: 'nexus.innovationss@gmail.com', // Dirección del remitente
        to: email, // Dirección del destinatario
        subject: 'Bienvenido a nuestra Compañía', // Asunto del correo
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #f4f4f4; padding: 20px; text-align: center;">
                    <img src="https://example.com/logo.png" alt="Logo de la empresa" style="max-width: 100px; height: auto;">
                </div>
                <div style="background-color: #ffffff; padding: 30px;">
                    <h2 style="color: #333333; text-align: center;">¡Bienvenido a nuestra Compañía!</h2>
                    <p style="font-size: 16px; line-height: 1.6; text-align: justify;">
                        Hola <strong>${nombre}</strong>,
                    </p>
                    <p style="font-size: 16px; line-height: 1.6; text-align: justify;">
                        Estás a punto de continuar con el proceso. Este mensaje es enviado para que accedas a nuestra plataforma y subas la documentación solicitada en el <strong>módulo de MENÚ DE EMPLEADOS</strong>.
                    </p>
                    <p style="font-size: 16px; line-height: 1.6; text-align: center;">
                        <strong>Enlace de la plataforma:</strong> <a href="http://localhost:3000/login" style="color: #333333; text-decoration: none;">http://localhost:3000/login</a>
                    </p>
                    <p style="font-size: 16px; line-height: 1.6;">
                        Tus credenciales para ingresar son:
                    </p>
                    <p style="font-size: 16px; line-height: 1.6; margin-bottom: 10px;">
                        Correo: <strong>${email}</strong>
                    </p>
                    <p style="font-size: 16px; line-height: 1.6; margin-bottom: 10px;">
                        Contraseña: <strong>${clave}</strong>
                    </p>
                    <p style="font-size: 16px; line-height: 1.6; text-align: justify;">
                        Por favor, asegúrate de completar este paso lo antes posible.
                    </p>
                </div>
                <div style="background-color: #f4f4f4; padding: 20px; text-align: center;">
                    <p style="font-size: 14px; color: #666666;">Este es un mensaje automático. Por favor, no respondas a este correo.</p>
                </div>
            </div>
        `
    };
    

    transporter.sendMail(mailOptions, function(error, info){
        if (error) {
            console.error('Error al enviar el correo:', error);
        } else {
            console.log('Correo enviado: ' + info.response);
        }
    });
}












// Ruta para la página principal 
app.get("/menuempresa", (req, res) => {
    if (req.session.loggedin === true) {
        const nombreUsuario = req.session.name;
        console.log(`El usuario ${nombreUsuario} está autenticado.`);
        req.session.nombreGuardado = nombreUsuario; // Guarda el nombre en la sesión

        const rolesString = req.session.roles;
        const roles = Array.isArray(rolesString) ? rolesString : [];



        const administrativo = roles.includes('administrativo');
        const empleado = roles.includes('empleado');
 

        res.render("EMPRESA/menuempresa.hbs",{ name: req.session.name,administrativo,empleado }); // Pasar los roles a la plantilla
    } else {
        res.redirect("/login");
    }
});















// Ruta para la página principal 
app.get("/menuempleados", (req, res) => {
    if (req.session.loggedin === true) {
        const nombreUsuario = req.session.name;
        console.log(`El usuario ${nombreUsuario} está autenticado.`);
        req.session.nombreGuardado = nombreUsuario; // Guarda el nombre en la sesión

        const rolesString = req.session.roles;
        const roles = Array.isArray(rolesString) ? rolesString : [];



        const administrativo = roles.includes('administrativo');
        const empleado = roles.includes('empleado');
 

        res.render("EMPLEADOS/menuempleados.hbs",{ name: req.session.name,administrativo,empleado }); // Pasar los roles a la plantilla
    } else {
        res.redirect("/login");
    }
});













const moment = require('moment'); // Importa moment.js si no lo has hecho aún





// Ruta para mostrar los datos del empleado y formulario para subir información adicional
app.get('/subirinformacion', async (req, res) => {
    if (req.session.loggedin === true) {
        const nombreUsuario = req.session.name;
        const connection = req.db;

        // Consulta para obtener los datos del empleado
        const sql = `SELECT id, nombre, apellido, tipo, documento, sexo, email, 
                             telefono, direccion, fechaNacimiento, rol,
                             tipo_sangre, estado_civil, emergencia_nombre, emergencia_telefono, foto
                     FROM empleados 
                     WHERE nombre = ?`;

        try {
            const [resultados] = await connection.query(sql, [nombreUsuario]);

            if (resultados.length === 0) {
                return res.status(404).send('Empleado no encontrado');
            }

            // Formatear la fecha de nacimiento
            const empleado = resultados[0];
            empleado.fechaNacimiento = moment(empleado.fechaNacimiento).format('DD MMMM YYYY');

            // Pasar empleado a la plantilla
            res.render('EMPLEADOS/documentos/subirinformacion', { empleado });
        } catch (err) {
            console.error('Error al obtener datos del empleado:', err);
            return res.status(500).send('Error interno al procesar la solicitud');
        }
    } else {
        res.redirect("/login");
    }
});



// Ruta para obtener la imagen del empleado por ID
app.get('/imagen/:id', async (req, res) => {
    const empleadoId = req.params.id;
    const connection = req.db;

    const sql = 'SELECT foto FROM empleados WHERE id = ?';

    try {
        const [results] = await connection.query(sql, [empleadoId]);

        if (results.length > 0 && results[0].foto) {
            // Escribir la imagen como respuesta
            const image = results[0].foto;
            res.writeHead(200, {
                'Content-Type': 'image/jpeg',
                'Content-Length': image.length
            });
            res.end(image); // Envía el BLOB como respuesta (en formato imagen)
        } else {
            return res.status(404).send('Imagen no encontrada');
        }
    } catch (err) {
        console.error('Error al obtener la imagen:', err);
        return res.status(500).send('Error interno al procesar la solicitud');
    }
});







// Configurar almacenamiento de multer para guardar fotos en memoria
const storageFotos = multer.memoryStorage();
const uploadFotos = multer({ storage: storageFotos });

// Configurar almacenamiento de multer para guardar documentos en el sistema de archivos
const storageDocumentos = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'src/public/uploads'); // Carpeta donde se guardarán los archivos
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});
const uploadDocumentos = multer({ storage: storageDocumentos });




// Ruta para actualizar empleados con foto
app.post('/update', uploadFotos.single('foto'), async (req, res) => {
    const empleado = req.body;
    const foto = req.file; // Si no se sube ninguna foto, req.file será undefined
    const connection = req.db;

    let sql;
    let sqlParams;

    if (foto) {
        // Se subió una nueva foto, obtener los datos binarios
        sql = `UPDATE empleados SET 
                   direccion = ?, 
                   tipo_sangre = ?, 
                   estado_civil = ?, 
                   emergencia_nombre = ?, 
                   emergencia_telefono = ?, 
                   foto = ?
               WHERE id = ?`;
        sqlParams = [
            empleado.direccion,
            empleado.tipo_sangre,
            empleado.estado_civil,
            empleado.emergencia_nombre,
            empleado.emergencia_telefono,
            foto.buffer, // Foto como dato binario
            empleado.id
        ];
    } else {
        // No se subió ninguna nueva foto, actualizar sin el campo de foto
        sql = `UPDATE empleados SET 
                   direccion = ?, 
                   tipo_sangre = ?, 
                   estado_civil = ?, 
                   emergencia_nombre = ?, 
                   emergencia_telefono = ?
               WHERE id = ?`;
        sqlParams = [
            empleado.direccion,
            empleado.tipo_sangre,
            empleado.estado_civil,
            empleado.emergencia_nombre,
            empleado.emergencia_telefono,
            empleado.id
        ];
    }

    try {
        await connection.query(sql, sqlParams);
        res.redirect('/subirinformacion');
    } catch (err) {
        console.error('Error al actualizar datos del empleado:', err);
        res.status(500).send('Error interno al procesar la solicitud');
    }
});





// Ruta para obtener la imagen del empleado por ID
app.get('/imagen/:id', async (req, res) => {
    const empleadoId = req.params.id;
    const connection = req.db;

    const sql = 'SELECT foto FROM empleados WHERE id = ?';

    try {
        const [results] = await connection.query(sql, [empleadoId]);

        if (results.length > 0 && results[0].foto) {
            // Escribir la imagen como respuesta
            const image = results[0].foto;
            res.writeHead(200, {
                'Content-Type': 'image/jpeg',
                'Content-Length': image.length
            });
            res.end(image); // Envía el BLOB como respuesta (en formato imagen)
        } else {
            return res.status(404).send('Imagen no encontrada');
        }
    } catch (err) {
        console.error('Error al obtener la imagen:', err);
        return res.status(500).send('Error interno al procesar la solicitud');
    }
});





// Ruta para mostrar los datos del empleado y formulario para subir información adicional
app.get('/mihojadevida', async (req, res) => {
    if (req.session.loggedin === true) {
        const nombreUsuario = req.session.name;
        const connection = req.db;

        // Consulta para obtener los datos del empleado
        const sql = `SELECT id, nombre, apellido, tipo, documento, sexo, email, 
                             telefono, direccion, fechaNacimiento, rol,
                             tipo_sangre, estado_civil, emergencia_nombre, emergencia_telefono, foto
                     FROM empleados 
                     WHERE nombre = ?`;

        try {
            const [resultados] = await connection.query(sql, [nombreUsuario]);

            if (resultados.length === 0) {
                return res.status(404).send('Empleado no encontrado');
            }

            // Formatear la fecha de nacimiento
            const empleado = resultados[0];
            empleado.fechaNacimiento = moment(empleado.fechaNacimiento).format('DD MMMM YYYY');

            // Pasar empleado a la plantilla
            res.render('EMPLEADOS/mihojadevida.hbs', { empleado });
        } catch (err) {
            console.error('Error al obtener datos del empleado:', err);
            return res.status(500).send('Error interno al procesar la solicitud');
        }
    } else {
        res.redirect("/login");
    }
});







// Ruta para la página principal
app.get("/subirdocumentos", async (req, res) => {
    if (req.session.loggedin === true) {
        const nombreUsuario = req.session.name;
        console.log(`El usuario ${nombreUsuario} está autenticado.`);
        req.session.nombreGuardado = nombreUsuario; // Guarda el nombre en la sesión

        const rolesString = req.session.roles;
        const roles = Array.isArray(rolesString) ? rolesString : [];

        const jefe = roles.includes('jefe');
        const empleado = roles.includes('empleado');

        const connection = req.db;
        const query = 'SELECT * FROM documentos WHERE usuario = ?';

        try {
            const [results] = await connection.query(query, [nombreUsuario]);
            const documentos = results.length ? results[0] : null;
            res.render("EMPLEADOS/documentos/subirdocumentos.hbs", { name: req.session.name, jefe, empleado, documentos });
        } catch (err) {
            console.error('Error al consultar la base de datos:', err);
            res.status(500).send('Error al cargar los documentos.');
        }
    } else {
        res.redirect("/login");
    }
});


const adjustPath = (path) => {
    if (!path) return null;
    return path.replace(/src[\\\/]public[\\\/]/, ''); // Elimina "src/public/" o "src\public\"
};


// Ruta para manejar la subida de documentos
app.post("/subirdocumentos", uploadDocumentos.fields([
    { name: 'documentoCedula' }, 
    { name: 'documentoContratacion' }, 
    { name: 'documentoTitulo' }, 
    { name: 'documentoTituloBachiller' }, 
    { name: 'documentoCertificaciones' }, 
    { name: 'documentoRecomendaciones' }, 
    { name: 'documentoAntecedentes' }, 
    { name: 'documentoExamenMedico' }, 
    { name: 'documentoFoto' }, 
    { name: 'documentoComprobanteDomicilio' }, 
    { name: 'documentoCesantias' },
    { name: 'documentoHojaVida' },
    { name: 'documentoEPS' },
    { name: 'documentoLibretaMilitar' },
    { name: 'documentoContraloria' }
]), async (req, res) => {
    if (req.session.loggedin === true) {
        const nombreUsuario = req.session.name;
        const connection = req.db;

        // Obtener las rutas de los archivos subidos, si existen, y ajustar las rutas
        const documentoCedulaPath = adjustPath(req.files.documentoCedula ? req.files.documentoCedula[0].path : null);
        const documentoContratacionPath = adjustPath(req.files.documentoContratacion ? req.files.documentoContratacion[0].path : null);
        const documentoTituloPath = adjustPath(req.files.documentoTitulo ? req.files.documentoTitulo[0].path : null);
        const documentoTituloBachillerPath = adjustPath(req.files.documentoTituloBachiller ? req.files.documentoTituloBachiller[0].path : null);
        const documentoCertificacionesPath = adjustPath(req.files.documentoCertificaciones ? req.files.documentoCertificaciones[0].path : null);
        const documentoRecomendacionesPath = adjustPath(req.files.documentoRecomendaciones ? req.files.documentoRecomendaciones[0].path : null);
        const documentoAntecedentesPath = adjustPath(req.files.documentoAntecedentes ? req.files.documentoAntecedentes[0].path : null);
        const documentoExamenMedicoPath = adjustPath(req.files.documentoExamenMedico ? req.files.documentoExamenMedico[0].path : null);
        const documentoFotoPath = adjustPath(req.files.documentoFoto ? req.files.documentoFoto[0].path : null);
        const documentoComprobanteDomicilioPath = adjustPath(req.files.documentoComprobanteDomicilio ? req.files.documentoComprobanteDomicilio[0].path : null);
        const documentoCesantiasPath = adjustPath(req.files.documentoCesantias ? req.files.documentoCesantias[0].path : null);
        const documentoHojaVidaPath = adjustPath(req.files.documentoHojaVida ? req.files.documentoHojaVida[0].path : null);
        const documentoEPSPath = adjustPath(req.files.documentoEPS ? req.files.documentoEPS[0].path : null);
        const documentoLibretaMilitarPath = adjustPath(req.files.documentoLibretaMilitar ? req.files.documentoLibretaMilitar[0].path : null);
        const documentoContraloriaPath = adjustPath(req.files.documentoContraloria ? req.files.documentoContraloria[0].path : null);

        try {
            // Consultar si ya existen documentos subidos para el usuario
            const query = 'SELECT * FROM documentos WHERE usuario = ?';
            const [results] = await connection.query(query, [nombreUsuario]);

            if (results.length > 0) {
                // Actualizar documentos existentes
                const updateDocumentQuery = `
                    UPDATE documentos SET
                    cedula_path = COALESCE(?, cedula_path),
                    contratacion_path = COALESCE(?, contratacion_path),
                    titulo_path = COALESCE(?, titulo_path),
                    titulo_bachiller_path = COALESCE(?, titulo_bachiller_path),
                    certificaciones_path = COALESCE(?, certificaciones_path),
                    recomendaciones_path = COALESCE(?, recomendaciones_path),
                    antecedentes_path = COALESCE(?, antecedentes_path),
                    examen_medico_path = COALESCE(?, examen_medico_path),
                    foto_path = COALESCE(?, foto_path),
                    comprobante_domicilio_path = COALESCE(?, comprobante_domicilio_path),
                    cesantias_path = COALESCE(?, cesantias_path),
                    hoja_vida_path = COALESCE(?, hoja_vida_path),
                    eps_path = COALESCE(?, eps_path),
                    libreta_militar_path = COALESCE(?, libreta_militar_path),
                    contraloria_path = COALESCE(?, contraloria_path)
                    WHERE usuario = ?`;
                await connection.query(updateDocumentQuery, [
                    documentoCedulaPath,
                    documentoContratacionPath,
                    documentoTituloPath,
                    documentoTituloBachillerPath,
                    documentoCertificacionesPath,
                    documentoRecomendacionesPath,
                    documentoAntecedentesPath,
                    documentoExamenMedicoPath,
                    documentoFotoPath,
                    documentoComprobanteDomicilioPath,
                    documentoCesantiasPath,
                    documentoHojaVidaPath,
                    documentoEPSPath,
                    documentoLibretaMilitarPath,
                    documentoContraloriaPath,
                    nombreUsuario
                ]);
                res.send('Archivos actualizados exitosamente.');
            } else {
                // Insertar nuevos documentos
                const insertDocumentQuery = 'INSERT INTO documentos (usuario, cedula_path, contratacion_path, titulo_path, titulo_bachiller_path, certificaciones_path, recomendaciones_path, antecedentes_path, examen_medico_path, foto_path, comprobante_domicilio_path, cesantias_path, hoja_vida_path, eps_path, libreta_militar_path, contraloria_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
                await connection.query(insertDocumentQuery, [
                    nombreUsuario,
                    documentoCedulaPath,
                    documentoContratacionPath,
                    documentoTituloPath,
                    documentoTituloBachillerPath,
                    documentoCertificacionesPath,
                    documentoRecomendacionesPath,
                    documentoAntecedentesPath,
                    documentoExamenMedicoPath,
                    documentoFotoPath,
                    documentoComprobanteDomicilioPath,
                    documentoCesantiasPath,
                    documentoHojaVidaPath,
                    documentoEPSPath,
                    documentoLibretaMilitarPath,
                    documentoContraloriaPath
                ]);
                res.send('Archivos subidos exitosamente.');
            }
        } catch (err) {
            console.error('Error al manejar la subida de documentos:', err);
            res.status(500).send('Error interno al procesar la solicitud');
        }
    } else {
        res.redirect("/login");
    }
});






// Servir archivos estáticos desde la carpeta 'src/uploads'
app.get('/validacion', async (req, res) => {
    if (req.session.loggedin === true) {
        const connection = req.db;
        const query = `
            SELECT * FROM documentos
            WHERE 
                COALESCE(cedula_validado, FALSE) = FALSE OR
                COALESCE(contratacion_validado, FALSE) = FALSE OR
                COALESCE(titulo_validado, FALSE) = FALSE OR
                COALESCE(titulo_bachiller_validado, FALSE) = FALSE OR
                COALESCE(certificaciones_validado, FALSE) = FALSE OR
                COALESCE(recomendaciones_validado, FALSE) = FALSE OR
                COALESCE(antecedentes_validado, FALSE) = FALSE OR
                COALESCE(examen_medico_validado, FALSE) = FALSE OR
                COALESCE(foto_validado, FALSE) = FALSE OR
                COALESCE(comprobante_domicilio_validado, FALSE) = FALSE OR
                COALESCE(cesantias_validado, FALSE) = FALSE OR
                COALESCE(hoja_vida_validado, FALSE) = FALSE OR
                COALESCE(eps_validado, FALSE) = FALSE OR
                COALESCE(libreta_militar_validado, FALSE) = FALSE OR
                COALESCE(contraloria_validado, FALSE) = FALSE
        `;

        try {
            const [results] = await connection.query(query);
            res.render('EMPRESA/Documentos/Validar_documentos.hbs', { documentos: results });
        } catch (err) {
            console.error('Error al obtener los documentos no validados:', err);
            return res.status(500).send('Error al obtener los documentos no validados.');
        }
    } else {
        // Manejo para el caso en que el usuario no está autenticado
        res.redirect("/login");
    }
});




app.post('/validardocumentos', async (req, res) => {
    const data = req.body;
    const updates = [];

    // Mapping of document types to their respective columns
    const documentColumnMap = {
        cedula: 'cedula_validado',
        contratacion: 'contratacion_validado',
        titulo: 'titulo_validado',
        titulo_bachiller: 'titulo_bachiller_validado',
        certificaciones: 'certificaciones_validado',
        recomendaciones: 'recomendaciones_validado',
        antecedentes: 'antecedentes_validado',
        examen_medico: 'examen_medico_validado',
        foto: 'foto_validado',
        comprobante_domicilio: 'comprobante_domicilio_validado',
        cesantias: 'cesantias_validado',
        hoja_vida: 'hoja_vida_validado',
        eps: 'eps_validado',
        libreta_militar: 'libreta_militar_validado',
        contraloria: 'contraloria_validado'
    };

    console.log('Received data:', data);

    for (const [key, value] of Object.entries(data)) {
        const [usuario, ...documentoParts] = key.split('_');
        const documento = documentoParts.join('_');
        const validado = value === 'si' ? 1 : 0;
        const column = documentColumnMap[documento];

        if (column) {
            updates.push({ validado, usuario, column });
        } else {
            console.warn(`Column not found for documento: ${documento}`);
        }
    }

    try {
        for (const update of updates) {
            const sql = `UPDATE documentos SET ${update.column} = ? WHERE usuario = ?`;
            console.log(`Executing SQL: ${sql} with values: [${update.validado}, ${update.usuario}]`);
            await req.db.query(sql, [update.validado, update.usuario]);
        }
        res.send('Validaciones guardadas correctamente');
    } catch (error) {
        console.error('Error executing update:', error);
        res.status(500).send('Ocurrió un error al guardar las validaciones');
    }
});















// Función para obtener usuarios con documentos validados
async function getUsuariosConDocumentosValidados() {
    const query = `
        SELECT usuario, cedula_validado, contratacion_validado, titulo_validado, titulo_bachiller_validado, 
               certificaciones_validado, recomendaciones_validado, antecedentes_validado, examen_medico_validado, 
               foto_validado, comprobante_domicilio_validado, cesantias_validado, hoja_vida_validado, 
               eps_validado, libreta_militar_validado, contraloria_validado
        FROM documentos
        WHERE 
            cedula_validado = '1' AND
            contratacion_validado = '1' AND
            titulo_validado = '1' AND
            titulo_bachiller_validado = '1' AND
            certificaciones_validado = '1' AND
            recomendaciones_validado = '1' AND
            antecedentes_validado = '1' AND
            examen_medico_validado = '1' AND
            foto_validado = '1' AND
            comprobante_domicilio_validado = '1' AND
            cesantias_validado = '1' AND
            hoja_vida_validado = '1' AND
            eps_validado = '1' AND
            libreta_militar_validado = '1' AND
            contraloria_validado = '1';
    `;
    
    const [rows] = await pool.query(query);
    return rows;
}

app.get('/enviar_contrato', async (req, res) => {
    if (req.session.loggedin === true) {
        try {
            const usuarios = await getUsuariosConDocumentosValidados();
            res.render('EMPRESA/contrato/enviar_contrato.hbs', { usuarios });
        } catch (error) {
            console.error(error);
            res.render('EMPRESA/usuarios_con_documentos_validados', { error: 'Error al obtener los usuarios.' });
        }
    } else {
        res.redirect("/login");
    }
});



app.get('/modificar_contrato/:usuario', async (req, res) => {
    const { usuario } = req.params;
    res.render('EMPLEADOS/contrato/modificar_contrato', { usuario });
});









app.post('/generar_contrato', async (req, res) => {
    const { usuario, ciudad, pais, fecha, cargo_empleado, duracion_contrato, fecha_inicio, fecha_terminacion, horas_trabajo, dia_inicio, dia_fin, horario_trabajo, monto_salario, moneda, periodicidad_pago, dia_pago } = req.body;
    
    try {
        // Obtener el email del usuario desde la tabla 'user'
        const [userResult] = await pool.query('SELECT email FROM user WHERE name = ?', [usuario]);
        if (userResult.length === 0) {
            return res.status(404).send('Usuario no encontrado');
        }
        const email = userResult[0].email;
        
        // Obtener los detalles del empleado desde la tabla 'empleados' usando el email
        const [empleadoResult] = await pool.query('SELECT nombre, apellido, email, telefono, direccion, fechaNacimiento, rol, tipo, documento, sexo, tipo_sangre, estado_civil, emergencia_nombre, emergencia_telefono FROM empleados WHERE email = ?', [email]);
        if (empleadoResult.length === 0) {
            return res.status(404).send('Empleado no encontrado');
        }
        const empleado = empleadoResult[0];
        
        // Contenido del contrato
        const contenido = `
            <div class="page">
                <h1 style="text-align: center; font-size: 24px; font-weight: bold;">CONTRATO DE TRABAJO</h1>
                <p style="text-align: center; font-size: 16px;">Entre [Nombre de la Empresa] y ${empleado.nombre} ${empleado.apellido}</p>
                <p style="font-size: 14px; text-align: justify;">
                    Este contrato de trabajo se celebra en <strong>${ciudad}</strong>, <strong>${pais}</strong>, el <strong>${fecha}</strong> entre:
                </p>
                
                <h2 style="font-size: 18px; font-weight: bold;">Partes</h2>
                <p style="font-size: 14px; text-align: justify;">
                    <strong>La Empresa:</strong> <span>[Nombre de la Empresa]</span>, con domicilio en <span>[Dirección de la Empresa]</span>, representada en este acto por <span>[Nombre del Representante]</span>, en su calidad de <span>[Cargo del Representante]</span>.
                    <div class="signature-placeholder" onclick="insertSignature(this)">Firmar Aquí</div>
                </p>
                <p style="font-size: 14px; text-align: justify;">
                    <strong>El Empleado:</strong> ${empleado.nombre} ${empleado.apellido}, identificado con cédula de ciudadanía número ${empleado.documento}, con domicilio en ${empleado.direccion}.
                    <div class="signature-placeholder" onclick="insertSignature(this)">Firmar Aquí</div>
                </p>
                
                <h2 style="font-size: 18px; font-weight: bold;">Objeto del Contrato</h2>
                <p style="font-size: 14px; text-align: justify;">
                    La Empresa contrata al Empleado para desempeñar las funciones de ${cargo_empleado}, de acuerdo con las condiciones y términos establecidos en este contrato.
                    <div class="signature-placeholder" onclick="insertSignature(this)">Firmar Aquí</div>
                </p>
                
                <h2 style="font-size: 18px; font-weight: bold;">Duración</h2>
                <p style="font-size: 14px; text-align: justify;">
                    Este contrato tendrá una duración de ${duracion_contrato}, comenzando el ${fecha_inicio} y terminando el ${fecha_terminacion}, pudiendo ser renovado por acuerdo mutuo entre las partes.
                    <div class="signature-placeholder" onclick="insertSignature(this)">Firmar Aquí</div>
                </p>
                
                <h2 style="font-size: 18px; font-weight: bold;">Jornada Laboral</h2>
                <p style="font-size: 14px; text-align: justify;">
                    El Empleado cumplirá una jornada laboral de ${horas_trabajo} horas semanales, de ${dia_inicio} a ${dia_fin}, con un horario de ${horario_trabajo}.
                    <div class="signature-placeholder" onclick="insertSignature(this)">Firmar Aquí</div>
                </p>
                
                <h2 style="font-size: 18px; font-weight: bold;">Remuneración</h2>
                <p style="font-size: 14px; text-align: justify;">
                    La Empresa pagará al Empleado un salario de ${monto_salario} ${moneda}, que se abonará de forma ${periodicidad_pago}, el ${dia_pago} de cada mes.
                    <div class="signature-placeholder" onclick="insertSignature(this)">Firmar Aquí</div>
                </p>
            </div>

            <div class="page">
                <h2 style="font-size: 18px; font-weight: bold;">Obligaciones del Empleado</h2>
                <p style="font-size: 14px; text-align: justify;">
                    El Empleado se compromete a cumplir con las siguientes obligaciones:
                    <ul style="list-style-type: disc; margin-left: 20px;">
                        <li>Desempeñar sus funciones con diligencia y eficiencia.</li>
                        <li>Respetar las políticas y procedimientos de la Empresa.</li>
                        <li>Guardar confidencialidad sobre la información de la Empresa.</li>
                        <li>Informar cualquier irregularidad o problema relacionado con su trabajo.</li>
                    </ul>
                    <div class="signature-placeholder" onclick="insertSignature(this)">Firmar Aquí</div>
                </p>
                
                <h2 style="font-size: 18px; font-weight: bold;">Obligaciones de la Empresa</h2>
                <p style="font-size: 14px; text-align: justify;">
                    La Empresa se compromete a cumplir con las siguientes obligaciones:
                    <ul style="list-style-type: disc; margin-left: 20px;">
                        <li>Pagar la remuneración acordada en tiempo y forma.</li>
                        <li>Proporcionar un entorno de trabajo seguro y saludable.</li>
                        <li>Ofrecer las herramientas y recursos necesarios para el desempeño del trabajo.</li>
                        <li>Respetar los derechos laborales del Empleado.</li>
                    </ul>
                    <div class="signature-placeholder" onclick="insertSignature(this)">Firmar Aquí</div>
                </p>
                
                <h2 style="font-size: 18px; font-weight: bold;">Terminación del Contrato</h2>
                <p style="font-size: 14px; text-align: justify;">
                    Este contrato podrá ser terminado por cualquiera de las partes, con un preaviso de ${duracion_contrato} días, o de forma inmediata por causa justificada, según lo establecido en la legislación laboral vigente.
                    <div class="signature-placeholder" onclick="insertSignature(this)">Firmar Aquí</div>
                </p>
                
                <h2 style="font-size: 18px; font-weight: bold;">Firma</h2>
                <p style="font-size: 14px; text-align: justify;">
                    En señal de conformidad, las partes firman el presente contrato en dos ejemplares de igual tenor y a un solo efecto, en el lugar y fecha indicados al inicio.
                    <div class="signature-placeholder" onclick="insertSignature(this)">Firmar Aquí</div>
                </p>
                
                <div style="margin-top: 50px; display: flex; justify-content: space-between;">
                    <p style="text-align: center; width: 45%;">
                        <img src="[Firma del Representante]" alt="Firma del Representante" style="width: 150px; height: auto;"><br>
                        _______________________________<br>
                        <strong>[Nombre del Representante]</strong><br>
                        Representante de la Empresa
                    </p>
                    
                    <p style="text-align: center; width: 45%;">
                        <div class="signature-placeholder" onclick="insertSignature(this)">Firmar Aquí</div><br>
                        _______________________________<br>
                        <strong>${empleado.nombre} ${empleado.apellido}</strong><br>
                        Empleado
                    </p>
                </div>
            </div>
        `;
        
        const query = `
            INSERT INTO contratos (usuario, contenido) VALUES (?, ?)
        `;
        await pool.query(query, [usuario, contenido]);
        res.send('Contrato generado correctamente');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al generar el contrato');
    }
});













const bodyParser = require('body-parser');




// Increase the body-parser limit
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));




app.get('/ver_contrato', async (req, res) => {
    if (req.session.loggedin === true) {
        const nombreUsuario = req.session.name;
        try {
            // Verificar si el usuario ya ha firmado el contrato
            const [firmaResult] = await pool.query('SELECT firma_empleado FROM contratos WHERE usuario = ?', [nombreUsuario]);
            
            if (firmaResult.length > 0 && firmaResult[0].firma_empleado) {
                res.send(`
                    <script>
                        alert('Ya ha firmado el contrato');
                        window.location.href = '/menuempleados';
                    </script>
                `);
            } else {
                // Obtener el contenido del contrato
                const [contratoResult] = await pool.query('SELECT contenido FROM contratos WHERE usuario = ?', [nombreUsuario]);
                if (contratoResult.length > 0) {
                    res.render('EMPLEADOS/contrato/ver_contrato', { contrato: contratoResult[0].contenido, usuario: nombreUsuario });
                } else {
                    res.status(404).send('Contrato no encontrado');
                }
            }
        } catch (error) {
            console.error(error);
            res.status(500).send('Error al cargar el contrato');
        }
    } else {
        res.redirect("/login");
    }
});

app.post('/guardar_firma', async (req, res) => {
    const { usuario, signature } = req.body;
    try {
        const query = `
            UPDATE contratos
            SET firma_empleado = ?, firmado = 1, fecha_firma = NOW()
            WHERE usuario = ?
        `;
        await pool.query(query, [signature, usuario]);
        res.send('Firma guardada correctamente');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al guardar la firma');
    }
});

app.get('/ver_contrato_firmado/:usuario', async (req, res) => {
    const { usuario } = req.params;
    try {
        const [result] = await pool.query('SELECT contenido, firma_empleado FROM contratos WHERE usuario = ?', [usuario]);
        if (result.length > 0) {
            const contrato = result[0].contenido.replace("[Firma del Empleado]", `<img src="${result[0].firma_empleado}" alt="Firma del Empleado" style="width: 150px; height: auto; display: block; margin: auto;">`);
            res.render('EMPLEADOS/contrato/ver_contrato', { contrato });
        } else {
            res.status(404).send('Contrato no encontrado');
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al cargar el contrato');
    }
});

app.post('/guardar_contrato', async (req, res) => {
    const { usuario, contrato } = req.body;
    try {
        const query = `
            UPDATE contratos
            SET contenido = ?
            WHERE usuario = ?
        `;
        await pool.query(query, [contrato, usuario]);
        res.send('Contrato guardado correctamente');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al guardar el contrato');
    }
});





app.listen(app.get("port"), () => {
    console.log("Server listening on port ", app.get("port"));  // Iniciar el servidor y escuchar en el puerto especificado
});
