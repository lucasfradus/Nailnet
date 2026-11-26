import type { CategoriaLista } from "./lista-precios-sicurella.ts";

/**
 * Tratamientos de Sicurella (Excel «PRECIOS 2026 SEPT», hojas FACIAL y CORPORAL, recibido el 2026-11-26).
 * `lista` es la columna TARJETA y `efectivo` la de Efectivo. El efectivo no es un porcentaje parejo (va de
 * −10 % a −20 %): las filas que no dan lista − 20 % se cargan como precio fijo del servicio (doc 32).
 *
 * Criterios al pasar el Excel:
 * - Los packs («6+3», «4+2») y la hoja COMBOS no se cargan: el sistema todavía no tiene packs.
 * - HIFU figura igual en las dos hojas: rostro va en Faciales y las zonas corporales en Corporales.
 * - Los que están en las dos hojas con precio distinto son servicios distintos: llevan «(Facial)» o
 *   «(Corporal)», como ya estaban en el catálogo.
 * - Las variantes de duración del Excel son servicios propios (Masaje Relajante 30', Descontracturante 1:30 hs).
 * - Duraciones: las del Excel donde las dice (Facial Express 40', Semi Completo 50', Completo 90'; Himfu y
 *   Vela 40' y Presoterapia 30', de la hoja COMBOS); el resto, las que ya tenía el catálogo o estimadas.
 * - Nombres corregidos: Exosomas, Vela Velvet, Jordi Shape; sin la «X» final de algunas filas.
 */
export const LISTA_TRATAMIENTOS: CategoriaLista[] = [
  {
    nombre: "Tratamientos Faciales", universo: "TRATAMIENTOS", antes: ["Tratamientos Faciales", "Faciales"], orden: 4, servicios: [
      { nombre: "Facial Express", minutos: 40, lista: 84000, efectivo: 70000 },
      { nombre: "Facial Semi Completo", minutos: 50, lista: 95000, efectivo: 80000 },
      { nombre: "Facial Completo", minutos: 90, lista: 100000, efectivo: 84000 },
      { nombre: "Altafrecuencia (Facial)", minutos: 60, lista: 100000, efectivo: 84000 },
      { nombre: "Crioradio Facial", minutos: 60, lista: 100000, efectivo: 84000 },
      { nombre: "Dermaplaning", minutos: 30, lista: 100000, efectivo: 84000 },
      { nombre: "Hidralips", minutos: 20, lista: 100000, efectivo: 84000 },
      { nombre: "Peeling Mandélico", minutos: 60, lista: 100000, efectivo: 84000 },
      { nombre: "Peeling de Verano", minutos: 60, lista: 100000, efectivo: 84000 },
      { nombre: "Peeling Enzimático", minutos: 60, lista: 100000, efectivo: 84000 },
      { nombre: "Peeling Glicólico", minutos: 60, lista: 100000, efectivo: 84000 },
      { nombre: "Peeling Salicílico", minutos: 60, lista: 100000, efectivo: 84000 },
      { nombre: "Peeling de Algas Marinas", minutos: 60, lista: 180000, efectivo: 150000 },
      { nombre: "Drenaje Facial", minutos: 30, lista: 70000, efectivo: 60000 },
      { nombre: "Yoga Facial", minutos: 50, lista: 75000, efectivo: 60000 },
      { nombre: "Plasma Frío (Facial)", minutos: 50, lista: 70000, efectivo: 60000 },
      { nombre: "Jordy (Facial)", minutos: 50, lista: 100000, efectivo: 84000 },
      { nombre: "Indiba (Facial)", minutos: 50, lista: 100000, efectivo: 84000 },
      { nombre: "Vita C Gold Glow", minutos: 50, lista: 100000, efectivo: 84000 },
      { nombre: "Frax Face (Facial)", minutos: 50, lista: 100000, efectivo: 84000 },
      { nombre: "Mesoterapia Virtual", minutos: 50, lista: 100000, efectivo: 84000 },
      { nombre: "Exosomas", minutos: 50, lista: 100000, efectivo: 84000 },
      { nombre: "Tratamiento Antiage", minutos: 50, lista: 100000, efectivo: 84000 },
      { nombre: "Rosácea", minutos: 50, lista: 100000, efectivo: 84000 },
      { nombre: "Radiofrecuencia (Facial)", minutos: 50, lista: 100000, efectivo: 84000 },
      { nombre: "Cabina Led", minutos: 30, lista: 145000, efectivo: 120000 },
      { nombre: "Dermapen", minutos: 50, lista: 100000, efectivo: 84000 },
      { nombre: "Hilos de Colágeno", minutos: 50, lista: 100000, efectivo: 84000 },
      { nombre: "HIFU Rostro, Papada y Cuello", minutos: 60, lista: 120000, efectivo: 100000 },
    ],
  },
  {
    nombre: "Tratamientos Corporales", universo: "TRATAMIENTOS", antes: ["Tratamientos Corporales", "Corporales"], orden: 5, servicios: [
      { nombre: "Masajes Relajantes", minutos: 50, lista: 75000, efectivo: 60000 },
      { nombre: "Masaje Relajante 30'", minutos: 30, lista: 50000, efectivo: 40000 },
      { nombre: "Masaje Descontracturante", minutos: 50, lista: 75000, efectivo: 60000 },
      { nombre: "Masaje Descontracturante 1:30 hs", minutos: 90, lista: 115000, efectivo: 100000 },
      { nombre: "Masaje con Drenaje Linfático", minutos: 50, lista: 75000, efectivo: 60000 },
      { nombre: "Masaje Reductor", minutos: 50, lista: 75000, efectivo: 60000 },
      { nombre: "Exfoliación Corporal", minutos: 50, lista: 100000, efectivo: 84000 },
      { nombre: "Maderoterapia", minutos: 50, lista: 75000, efectivo: 60000 },
      { nombre: "Masaje Deportivo", minutos: 50, lista: 75000, efectivo: 60000 },
      { nombre: "Masaje Criomodelador", minutos: 50, lista: 75000, efectivo: 60000 },
      { nombre: "Masaje con Piedras Calientes", minutos: 50, lista: 75000, efectivo: 60000 },
      { nombre: "Reflexología", minutos: 50, lista: 75000, efectivo: 60000 },
      { nombre: "Masaje Capilar", minutos: 50, lista: 75000, efectivo: 60000 },
      { nombre: "Masaje con Vendas Frías", minutos: 50, lista: 75000, efectivo: 60000 },
      { nombre: "Masaje a 4 Manos", minutos: 50, lista: 150000, efectivo: 120000 },
      { nombre: "Altafrecuencia (Corporal)", minutos: 50, lista: 90000, efectivo: 75000 },
      { nombre: "Cavix", minutos: 50, lista: 100000, efectivo: 85000 },
      { nombre: "Criolipólisis + 20' de Drenaje (2 zonas)", minutos: 80, lista: 145000, efectivo: 120000 },
      { nombre: "Crioradiofrecuencia", minutos: 50, lista: 114000, efectivo: 95000 },
      { nombre: "Electrodos", minutos: 30, lista: 50000, efectivo: 45000 },
      { nombre: "Electroporador", minutos: 50, lista: 110000, efectivo: 90000 },
      { nombre: "Frax Face (Corporal)", minutos: 50, lista: 175000, efectivo: 145000 },
      { nombre: "Go Mac (2 zonas)", minutos: 60, lista: 75000, efectivo: 60000 },
      { nombre: "Himfu", minutos: 40, lista: 100000, efectivo: 85000 },
      { nombre: "Indiba (Corporal)", minutos: 50, lista: 100000, efectivo: 85000 },
      { nombre: "Jordi Shape", minutos: 50, lista: 100000, efectivo: 85000 },
      { nombre: "Mio Up (2 zonas)", minutos: 60, lista: 75000, efectivo: 60000 },
      { nombre: "Ondas de Choque", minutos: 20, lista: 90000, efectivo: 75000 },
      { nombre: "Plasma Frío (Corporal)", minutos: 50, lista: 120000, efectivo: 100000 },
      { nombre: "Presoterapia", minutos: 30, lista: 54000, efectivo: 45000 },
      { nombre: "Radiofrecuencia (Corporal)", minutos: 50, lista: 95000, efectivo: 78000 },
      { nombre: "Thermobike", minutos: 60, lista: 75000, efectivo: 60000 },
      { nombre: "Ultracavitador", minutos: 50, lista: 100000, efectivo: 85000 },
      { nombre: "Ultrasonido (Drenaje)", minutos: 50, lista: 100000, efectivo: 85000 },
      { nombre: "Vela Velvet", minutos: 40, lista: 100000, efectivo: 85000 },
      { nombre: "HIFU 1 Zona Corporal", minutos: 60, lista: 120000, efectivo: 100000 },
      { nombre: "HIFU 3 Zonas Corporal", minutos: 90, lista: 240000, efectivo: 200000 },
    ],
  },
];
