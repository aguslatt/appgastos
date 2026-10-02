/**
 * Words and phrases that hint at a kind of expense, in everyday Spanish (with
 * Rioplatense slang and common brands). The keys are the `kind` of the default
 * folders. Matching ignores case, accents and plurals, so write them naturally.
 */
export const KEYWORDS: Record<string, string> = {
  comida: `
    propina, propinas, tip, restaurante, restaurant, resto, parrilla, pizzeria, pizza, pizzas, hamburguesa, burger,
    mcdonalds, mc donalds, burger king, kfc, wendys, subway, starbucks, havanna, cafe, cafecito, cafeteria, cortado,
    capuchino, latte, medialuna, medialunas, tostado, sandwich, sanguche, lomito, milanesa, empanada, empanadas,
    helado, heladeria, freddo, grido, postre, delivery, pedidosya, pedidos ya, rappi, uber eats, ubereats, glovo,
    didi food, just eat, cena, almuerzo, desayuno, merienda, brunch, comida, comer, bar, cerveceria, cerveza, birra,
    birras, trago, tragos, fernet, copa, copas, sushi, wok, kiosco, snack, golosinas, alfajor, chocolate, comida rapida,
    fast food, take away, takeaway, menu, combo, asado, picada, tapeo, tapas, bodegon, rotiseria, vianda,
    after office, cafe con leche, torta, tortas, pancho, panchos, choripan, hot dog, tacos, taco,
    cena con amigos, almuerzo con amigos, comida china, comida japonesa, comida peruana, comida mexicana
  `,
  super: `
    super, supermercado, supermercados, hipermercado, mercado, almacen, autoservicio, coto, carrefour, jumbo, disco, vea,
    changomas, chango mas, walmart, lider, tottus, unimarc, exito, d1, ara, oxxo, soriana, chedraui, mercadona, lidl,
    aldi, eroski, chino, super chino, verduleria, verdura, verduras, fruta, frutas, fruteria, carniceria, carne, carnes,
    pollo, pescaderia, fiambre, fiambreria, fiambres, lacteos, queso, quesos, panaderia, pan, mercadito, feria,
    despensa, abarrotes, bodega, minimarket, mini market, huevos, leche, arroz, fideos, aceite, harina, yerba, azucar,
    gaseosas, galletitas, limpieza, detergente, lavandina, papel higienico, jabon, shampoo, desodorante, higiene,
    compras del super, compra del super, mandado, mercaderia, dietetica, granja, polleria
  `,
  transporte: `
    uber, cabify, didi, indrive, in drive, taxi, taxis, remis, remise, radio taxi, colectivo, bondi, micro, omnibus,
    autobus, subte, metro, tren, sube, carga sube, carga de sube, tarjeta transporte, peaje, estacionamiento, cochera,
    parking, nafta, combustible, gasolina, gasoil, diesel, carga de nafta, ypf, shell, axion, puma, gnc, service auto,
    mecanico, gomeria, lavadero, patente, seguro auto, bici, bicicleta, monopatin, pasaje, pasajes, boleto, ruta,
    viaje en taxi, vtv, aceite auto, auto, moto, flete, escuela de manejo, licencia de conducir, bencina, transmilenio
  `,
  hogar: `
    alquiler, renta, expensas, hipoteca, cuota casa, mantenimiento, plomero, electricista, gasista, cerrajero,
    ferreteria, pintura, pintor, reparacion, arreglo, arreglos, muebles, mueble, colchon, sillon, decoracion, deco,
    ikea, easy, sodimac, homecenter, seguro hogar, empleada domestica, domestica, senora de la limpieza, jardinero,
    jardin, pileta, lavarropas, heladera, cocina, microondas, vajilla, ropa de cama, sabanas, toallas, cortinas,
    lampara, mudanza, inmobiliaria, deposito, alquiler casa, alquiler depto, depto, departamento
  `,
  servicios: `
    luz, electricidad, edenor, edesur, epec, gas, metrogas, naturgy, agua, aysa, internet, wifi, fibra, fibertel,
    telecentro, claro, movistar, tuenti, plan celular, celular, recarga, recarga celular, telefono, cable,
    directv, flow, tv cable, abl, inmobiliario, municipal, tasa, tasas, impuesto, impuestos, monotributo, afip, arba,
    iva, autonomos, comision, comisiones, mantenimiento de cuenta, banco, factura, facturas,
    factura de luz, factura de gas, boleta, boletas, servicio, servicios, cuota monotributo, sellos, gestoria, tramite, tramites, correo, envio
  `,
  salud: `
    farmacia, farmacity, remedio, remedios, medicamento, medicamentos, medicina, pastillas, medico, doctor, doctora,
    consulta, turno medico, clinica, sanatorio, hospital, guardia, analisis, laboratorio, radiografia, ecografia,
    estudios medicos, dentista, odontologo, ortodoncia, oculista, anteojos, lentes, optica, psicologo, psicologa, terapia,
    kinesiologo, kinesio, nutricionista, obra social, prepaga, osde, swiss medical, galeno, medicus, vacuna,
    dermatologo, ginecologo, pediatra, cobertura, copago, gimnasio, gym, pilates, yoga, crossfit, vitaminas,
    suplementos, proteina, curitas, analgesico, ibuprofeno, paracetamol, alergia, tratamiento
  `,
  ocio: `
    cine, pelicula, teatro, recital, concierto, show, entradas, entrada, ticket, tickets, ticketek, boliche, joda,
    salida, salidas, previa, fiesta, karaoke, bowling, pool, billar, juego, juegos, videojuego, steam, playstation,
    psn, xbox, nintendo, parque, museo, club, deporte, cancha, futbol, padel, tenis, natacion, excursion, paseo,
    juntada, hobby, casino, bingo, apuesta, apuestas, escape room, parque de diversiones, feria de artesanos,
    campamento, camping, pesca, boliches, discoteca, disco bar, festival, stand up, circo, zoologico, acuario
  `,
  compras: `
    ropa, remera, camisa, pantalon, jean, vestido, campera, abrigo, zapatillas, zapatos, calzado, botas, medias,
    ropa interior, shopping, zara, h&m, nike, adidas, mercadolibre, mercado libre, amazon, aliexpress, shein, temu,
    tienda, compra, compras, electronica, notebook, compu, computadora, tele, televisor, auriculares, cargador,
    accesorio, accesorios, regalo, regalos, cumpleanos, perfume, maquillaje, cosmetica, peluqueria, barberia,
    corte de pelo, unas, manicura, spa, masajes, joyas, reloj, cartera, mochila, valija, lentes de sol, anillo, collar,
    celular nuevo, tablet, teclado, mouse, monitor, juguete, juguetes, bijouterie, libreria artistica
  `,
  educacion: `
    curso, cursos, clase, clases, profe, profesor, profesora, academia, colegio, escuela, jardin maternal,
    cuota colegio, universidad, facultad, matricula, inscripcion, libro, libros, libreria, utiles, cuaderno,
    fotocopias, apuntes, idioma, ingles, platzi, udemy, coursera, posgrado, maestria, certificacion, examen,
    taller, capacitacion, seminario, congreso, apoyo escolar, guarderia, maternal, mochila escolar
  `,
  suscripciones: `
    netflix, spotify, disney, disney plus, hbo, hbo max, max, prime, prime video, amazon prime, youtube premium,
    youtube, apple, icloud, google one, dropbox, chatgpt, openai, claude, notion, canva, adobe, office,
    microsoft 365, game pass, gamepass, ps plus, psplus, twitch, crunchyroll, paramount, star plus, suscripcion,
    membresia, mensualidad, tinder, linkedin, duolingo, deezer, tidal, kindle, audible, patreon, hosting, dominio,
    vpn, antivirus, cloud, streaming, plan anual, plan mensual, renovacion
  `,
  mascotas: `
    veterinario, veterinaria, vete, alimento perro, alimento gato, balanceado, perro, gato, mascota, mascotas,
    arena gatos, arena sanitaria, peluqueria canina, paseador, guarderia canina, antipulgas, collar perro, correa,
    pet shop, petshop, cucha, pecera, hamster, loro, tortuga, caballo
  `,
  otros: `
    otro, otros, varios, misc, imprevisto, imprevistos, multa, donacion, limosna, ayuda, prestamo, cuota, deuda
  `,
};
