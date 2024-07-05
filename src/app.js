const express = require("express");
const session = require("express-session");
const mysql = require("mysql2");
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


app.use(express.json());  // Middleware para parsear JSON en las solicitudes
app.use(express.urlencoded({ extended: true }));  // Middleware para parsear URL-encoded en las solicitudes
app.use(express.static(__dirname + '/public'));  // Middleware para servir archivos estáticos desde el directorio 'public'

// Crea un pool de conexiones
const pool = mysql.createPool({
    host: '127.0.0.1',
    user: 'root',
    password: '',
    database: 'Recursos_Humanos',
    waitForConnections: true,
    connectionLimit: 10, // Número máximo de conexiones en el pool
    queueLimit: 0 // Número máximo de solicitudes en cola (0 = ilimitado)
});

// Exporta el pool para usarlo en otros módulos
module.exports = pool;


// Session middleware
app.use(session({
    secret: "secret",  // Clave secreta para firmar la cookie de sesión
    resave: true,  // Forzar a que la sesión se guarde de nuevo en el almacenamiento de sesiones
    saveUninitialized: true  // Forzar a que una sesión se guarde, aunque no haya datos para almacenar
}));





// Middleware para pasar una conexión del pool a cada objeto de solicitud
app.use((req, res, next) => {
    pool.getConnection((err, connection) => {
        if (err) {
            return next(err);
        }
        req.db = connection;
        res.on('finish', () => {
            req.db.release();
        });
        next();
    });
});



// Render login form
app.get("/login", (req, res) => {
    if (req.session.loggedin) {
        res.redirect("/");  // Redirigir a la página principal si ya está autenticado
    } else {
        res.render("login/index.hbs", { error: null });  // Renderizar el formulario de inicio de sesión con un mensaje de error nulo
    }
});





// Handle login authentication
app.post("/auth", (req, res) => {
    const data = req.body;
    const connection = req.db;

    connection.query("SELECT * FROM user WHERE email = ? AND password = ?", [data.email, data.password], (err, userData) => {
        if (err) {
            console.error("Error fetching user from database:", err);  // Manejar errores al recuperar datos del usuario desde la base de datos
            res.status(500).send("Internal Server Error");  // Enviar respuesta de error interno del servidor
            return;
        }

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
    });
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
app.post("/storeUser", (req, res) => {
    const data = req.body;
    const connection = req.db;

    connection.query("SELECT * FROM user WHERE email = ?", [data.email], (err, userData) => {
        if (err) {
            console.error("Error fetching user from database:", err);  // Manejar errores al recuperar datos del usuario desde la base de datos
            res.status(500).send("Internal Server Error");  // Enviar respuesta de error interno del servidor
            return;
        }

        if (userData.length > 0) {
            res.render("login/register.hbs", { error: "User with this email already exists" });  // Renderizar página de registro con mensaje de usuario ya existente
            return;
        }

        connection.query("INSERT INTO user SET ?", data, (err, rows) => {
            if (err) {
                console.error("Error inserting user into database:", err);  // Manejar errores al insertar usuario en la base de datos
                res.status(500).send("Internal Server Error");  // Enviar respuesta de error interno del servidor
            } else {
                console.log("User registered successfully");  // Registrar registro exitoso del usuario
                res.redirect("/");  // Redirigir a la página principal después del registro exitoso
            }
        });
    });
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
app.post("/forgot-password", (req, res) => {
    const { email } = req.body;
    const connection = req.db;

    // Generar un token único y establecer la fecha de expiración
    const resetToken = crypto.randomBytes(20).toString('hex');
    const resetTokenExpiration = new Date();
    resetTokenExpiration.setHours(resetTokenExpiration.getHours() + 1); // Token válido por 1 hora

    connection.query("UPDATE user SET resetToken = ?, resetTokenExpiration = ? WHERE email = ?", [resetToken, resetTokenExpiration, email], (err, result) => {
        if (err) {
            console.error("Error updating reset token in database:", err);
            res.status(500).send("Internal Server Error");
            return;
        }

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
    });
});

// Página para restablecer la contraseña (GET)
app.get("/reset-password", (req, res) => {
    const token = req.query.token; // Obtiene el token de la consulta
    console.log("Token recibido en GET:", token);
  
    // Verificar si el token es válido y está dentro del tiempo de expiración adecuado
    connection.query(
      "SELECT * FROM user WHERE resetToken = ? AND resetTokenExpiration > NOW()",
      [token],
      (err, results) => {
        if (err) {
          console.error("Error al verificar el token:", err);
          res.status(500).send("Error interno al verificar el token");
        } else {
          if (results.length === 0) {
            res.status(400).send("El token para restablecer la contraseña es inválido o ha expirado");
          } else {
            // Mostrar el formulario para restablecer la contraseña
            res.render("login/reset-password.hbs", { token });
          }
        }
      }
    );
});

// Procesar restablecimiento de contraseña (POST)
app.post("/reset-password", (req, res) => {
    const { token, password } = req.body;

    // Verificar si el token es válido y está dentro del tiempo de expiración adecuado
    connection.query(
      "SELECT * FROM user WHERE resetToken = ? AND resetTokenExpiration > NOW()",
      [token],
      (err, results) => {
        if (err) {
          console.error("Error al verificar el token:", err);
          res.status(500).send("Error interno al verificar el token");
        } else {
          if (results.length === 0) {
            res.status(400).send("El token para restablecer la contraseña es inválido o ha expirado");
          } else {
            const user = results[0];

            // Actualizar la contraseña en la base de datos y limpiar el token
            connection.query(
              "UPDATE user SET password = ?, resetToken = NULL, resetTokenExpiration = NULL WHERE id = ?",
              [password, user.id],
              (updateErr, updateResult) => {
                if (updateErr) {
                  console.error("Error al actualizar la contraseña:", updateErr);
                  res.status(500).send("Error interno al actualizar la contraseña");
                } else {
                  console.log("Contraseña actualizada exitosamente para el usuario:", user.email);

                  // Redirigir al usuario a la página de inicio de sesión con un mensaje de éxito
                  res.render("login/index.hbs", { successMessage: "Contraseña restablecida exitosamente" });
                }
              }
            );
          }
        }
      }
    );
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
app.post('/guardarEmpleado', (req, res) => {
    const { nombre, apellido, tipo, email, documento, sexo, telefono, direccion, fechaNacimiento, rol } = req.body;
    const connection = req.db;

    // Verificar si el email ya está registrado
    const sqlCheckEmail = 'SELECT COUNT(*) AS count FROM empleados WHERE email = ?';
    connection.query(sqlCheckEmail, [email], (err, results) => {
        if (err) {
            console.error('Error al verificar el correo electrónico:', err);
            return res.status(500).send('Error interno al verificar el correo electrónico');
        }

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

        connection.beginTransaction(function(err) {
            if (err) {
                console.error('Error al comenzar la transacción:', err);
                return res.status(500).send('Error interno al guardar el empleado');
            }

            // Insertar en la tabla empleados
            connection.query(sqlEmpleado, nuevoEmpleado, (err, resultEmpleado) => {
                if (err) {
                    connection.rollback(function() {
                        console.error('Error al guardar el empleado en la tabla "empleados":', err);
                        return res.status(500).send('Error interno al guardar el empleado');
                    });
                } else {
                    console.log('Nuevo empleado creado en la tabla "empleados":', resultEmpleado.insertId);

                    // Insertar en la tabla users
                    connection.query(sqlUser, [nombre, email, clave], (err, resultUser) => {
                        if (err) {
                            connection.rollback(function() {
                                console.error('Error al guardar el empleado en la tabla "users":', err);
                                return res.status(500).send('Error interno al guardar el empleado');
                            });
                        } else {
                            console.log('Nuevo usuario creado en la tabla "users":', resultUser.insertId);

                            // Commit la transacción si todo fue exitoso
                            connection.commit(function(err) {
                                if (err) {
                                    connection.rollback(function() {
                                        console.error('Error al hacer commit de la transacción:', err);
                                        return res.status(500).send('Error interno al guardar el empleado');
                                    });
                                } else {
                                    console.log('Transacción completada, empleado y usuario creados correctamente.');

                                    // Envío de correo electrónico al empleado con la clave
                                    enviarCorreo(email, nombre, clave);

                                    // Redirigir al usuario a la página de nuevo usuario
                                    res.redirect('/nuevoUsuario');
                                }
                            });
                        }
                    });
                }
            });
        });
    });
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



        const jefe = roles.includes('jefe');
        const empleado = roles.includes('empleado');
 

        res.render("EMPRESA/menuempresa.hbs",{ name: req.session.name,jefe,empleado }); // Pasar los roles a la plantilla
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



        const jefe = roles.includes('jefe');
        const empleado = roles.includes('empleado');
 

        res.render("EMPLEADOS/menuempleados.hbs",{ name: req.session.name,jefe,empleado }); // Pasar los roles a la plantilla
    } else {
        res.redirect("/login");
    }
});









const moment = require('moment'); // Importa moment.js si no lo has hecho aún





// Ruta para mostrar los datos del empleado y formulario para subir información adicional
app.get('/subirinformacion', (req, res) => {
    if (req.session.loggedin === true) {
        const nombreUsuario = req.session.name;
        const connection = req.db;

        // Consulta para obtener los datos del empleado
        const sql = `SELECT id, nombre, apellido, tipo, documento, sexo, email, 
                             telefono, direccion, fechaNacimiento, rol,
                             tipo_sangre, estado_civil, emergencia_nombre, emergencia_telefono, foto
                     FROM empleados 
                     WHERE nombre = ?`;
        connection.query(sql, [nombreUsuario], (err, resultados) => {
            if (err) {
                console.error('Error al obtener datos del empleado:', err);
                return res.status(500).send('Error interno al procesar la solicitud');
            }

            if (resultados.length === 0) {
                return res.status(404).send('Empleado no encontrado');
            }

            // Formatear la fecha de nacimiento
            const empleado = resultados[0];
            empleado.fechaNacimiento = moment(empleado.fechaNacimiento).format('DD MMMM YYYY');

            // Pasar empleado a la plantilla
            res.render('EMPLEADOS/documentos/subirinformacion', { empleado });
        });
    } else {
        res.redirect("/login");
    }
});



// Ruta para obtener la imagen del empleado por ID
app.get('/imagen/:id', (req, res) => {
    const empleadoId = req.params.id;
    const connection = req.db;

    const sql = 'SELECT foto FROM empleados WHERE id = ?';
    connection.query(sql, [empleadoId], (err, results) => {
        if (err) {
            console.error('Error al obtener la imagen:', err);
            return res.status(500).send('Error interno al procesar la solicitud');
        }

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
    });
});






// Configurar almacenamiento de multer para guardar archivos en el sistema de archivos
// Configurar almacenamiento de multer para guardar archivos en el sistema de archivos
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'src/uploads'); // Carpeta donde se guardarán los archivos
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }




});
const upload = multer({ storage: storage });


    app.post('/update', upload.single('foto'), (req, res) => {
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
    
        connection.query(sql, sqlParams, (err, result) => {
            if (err) {
                console.error('Error al actualizar datos del empleado:', err);
                return res.status(500).send('Error interno al procesar la solicitud');
            }
    
            res.redirect('/subirinformacion');
        });
    });
    











// Ruta para obtener la imagen del empleado por ID
app.get('/imagen/:id', (req, res) => {
    const empleadoId = req.params.id;
        const connection = req.db;

    const sql = 'SELECT foto FROM empleados WHERE id = ?';
    connection.query(sql, [empleadoId], (err, results) => {
        if (err) {
            console.error('Error al obtener la imagen:', err);
            return res.status(500).send('Error interno al procesar la solicitud');
        }

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
    });
});






// Ruta para mostrar los datos del empleado y formulario para subir información adicional
app.get('/mihojadevida', (req, res) => {
    if (req.session.loggedin === true) {
        const nombreUsuario = req.session.name;
        const connection = req.db;

        // Consulta para obtener los datos del empleado
        const sql = `SELECT id, nombre, apellido, tipo, documento, sexo, email, 
                             telefono, direccion, fechaNacimiento, rol,
                             tipo_sangre, estado_civil, emergencia_nombre, emergencia_telefono, foto
                     FROM empleados 
                     WHERE nombre = ?`;
        connection.query(sql, [nombreUsuario], (err, resultados) => {
            if (err) {
                console.error('Error al obtener datos del empleado:', err);
                return res.status(500).send('Error interno al procesar la solicitud');
            }

            if (resultados.length === 0) {
                return res.status(404).send('Empleado no encontrado');
            }

            // Formatear la fecha de nacimiento
            const empleado = resultados[0];
            empleado.fechaNacimiento = moment(empleado.fechaNacimiento).format('DD MMMM YYYY');

            // Pasar empleado a la plantilla
            res.render('EMPLEADOS/mihojadevida.hbs', { empleado });
        });
    } else {
        res.redirect("/login");
    }
});









// Crear el directorio 'uploads' si no existe
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Ruta para la página principal
app.get("/subirdocumentos", (req, res) => {
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
        connection.query(query, [nombreUsuario], (err, results) => {
            if (err) {
                console.error('Error al consultar la base de datos:', err);
                res.status(500).send('Error al cargar los documentos.');
                return;
            }

            const documentos = results.length ? results[0] : null;
            res.render("EMPLEADOS/documentos/subirdocumentos.hbs", { name: req.session.name, jefe, empleado, documentos });
        });
    } else {
        res.redirect("/login");
    }
});




// Ruta para manejar la subida de documentos
app.post("/subirdocumentos", upload.fields([
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
]), (req, res) => {
    if (req.session.loggedin === true) {
        const nombreUsuario = req.session.name;
        const connection = req.db;

        // Obtener las rutas de los archivos subidos, si existen
        const documentoCedulaPath = req.files.documentoCedula ? req.files.documentoCedula[0].path : null;
        const documentoContratacionPath = req.files.documentoContratacion ? req.files.documentoContratacion[0].path : null;
        const documentoTituloPath = req.files.documentoTitulo ? req.files.documentoTitulo[0].path : null;
        const documentoTituloBachillerPath = req.files.documentoTituloBachiller ? req.files.documentoTituloBachiller[0].path : null;
        const documentoCertificacionesPath = req.files.documentoCertificaciones ? req.files.documentoCertificaciones[0].path : null;
        const documentoRecomendacionesPath = req.files.documentoRecomendaciones ? req.files.documentoRecomendaciones[0].path : null;
        const documentoAntecedentesPath = req.files.documentoAntecedentes ? req.files.documentoAntecedentes[0].path : null;
        const documentoExamenMedicoPath = req.files.documentoExamenMedico ? req.files.documentoExamenMedico[0].path : null;
        const documentoFotoPath = req.files.documentoFoto ? req.files.documentoFoto[0].path : null;
        const documentoComprobanteDomicilioPath = req.files.documentoComprobanteDomicilio ? req.files.documentoComprobanteDomicilio[0].path : null;
        const documentoCesantiasPath = req.files.documentoCesantias ? req.files.documentoCesantias[0].path : null;
        const documentoHojaVidaPath = req.files.documentoHojaVida ? req.files.documentoHojaVida[0].path : null;
        const documentoEPSPath = req.files.documentoEPS ? req.files.documentoEPS[0].path : null;
        const documentoLibretaMilitarPath = req.files.documentoLibretaMilitar ? req.files.documentoLibretaMilitar[0].path : null;
        const documentoContraloriaPath = req.files.documentoContraloria ? req.files.documentoContraloria[0].path : null;

        // Consultar si ya existen documentos subidos para el usuario
        const query = 'SELECT * FROM documentos WHERE usuario = ?';
        connection.query(query, [nombreUsuario], (err, results) => {
            if (err) {
                console.error('Error al consultar la base de datos:', err);
                res.status(500).send('Error al verificar los documentos existentes.');
                return;
            }

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
                connection.query(updateDocumentQuery, [
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
                ], (err, result) => {
                    if (err) {
                        console.error('Error al actualizar los archivos en la base de datos:', err);
                        res.status(500).send('Error al actualizar los archivos.');
                    } else {
                        res.send('Archivos actualizados exitosamente.');
                    }
                });
            } else {
                // Insertar nuevos documentos
                const insertDocumentQuery = 'INSERT INTO documentos (usuario, cedula_path, contratacion_path, titulo_path, titulo_bachiller_path, certificaciones_path, recomendaciones_path, antecedentes_path, examen_medico_path, foto_path, comprobante_domicilio_path, cesantias_path, hoja_vida_path, eps_path, libreta_militar_path, contraloria_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
                connection.query(insertDocumentQuery, [
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
                ], (err, result) => {
                    if (err) {
                        console.error('Error al guardar los archivos en la base de datos:', err);
                        res.status(500).send('Error al guardar los archivos.');
                    } else {
                        res.send('Archivos subidos exitosamente.');
                    }
                });
            }
        });
    } else {
        res.redirect("/login");
    }
});


app.get('/verdocumentos', (req, res) => {
    if (req.session.loggedin === true) {
        const nombreUsuario = req.session.name;
        const connection = req.db;

        // Obtener las rutas de los documentos del empleado
        const getDocumentsQuery = 'SELECT cedula_path, contratacion_path FROM documentos WHERE usuario = ?';
        connection.query(getDocumentsQuery, [nombreUsuario], (err, results) => {
            if (err) {
                console.error('Error al obtener los documentos del empleado:', err);
                return res.status(500).send('Error al obtener los documentos.');
            }

            if (results.length === 0) {
                return res.status(404).send('No se encontraron documentos para el usuario.');
            }

            const documentos = results[0];
            res.render('verdocumentos', { documentos });
        });
    } else {
        res.redirect("/login");
    }
});


// Start server
app.listen(app.get("port"), () => {
    console.log("Server listening on port ", app.get("port"));  // Iniciar el servidor y escuchar en el puerto especificado
});
