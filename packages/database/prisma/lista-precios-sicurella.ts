/**
 * Lista de precios de Sicurella (PDFs «Lista nails» y «Lista pestañas, cejas y depilación», actualizados,
 * recibidos el 2026-11-25). `lista` es el precio de lista (tarjeta) y `efectivo` el que figura en el PDF:
 * en todas las filas es lista − 20 %, que el sistema calcula con el ajuste del medio de pago (doc 32). Una
 * fila cuyo efectivo no salga de ese ajuste se carga como precio fijo del servicio para Efectivo y Transferencia.
 * Las duraciones no están en el PDF: son estimadas y se ajustan desde Catálogo.
 */
export type ItemLista = { nombre: string; minutos: number; lista: number; efectivo: number };
/**
 * `antes`: nombres de categorías anteriores que esta reemplaza (para vaciar solo lo cubierto y habilitar
 * profesionales). `orden`: posición de la categoría (por defecto, la de la lista).
 */
export type CategoriaLista = { nombre: string; universo: "MANOS_PIES" | "TRATAMIENTOS"; antes: string[]; orden?: number; servicios: ItemLista[] };

export const AJUSTE_EFECTIVO = "-20";

export const LISTA_PRECIOS: CategoriaLista[] = [
  {
    nombre: "Nails", universo: "MANOS_PIES", antes: ["Nails", "Manos", "Pies"], servicios: [
      { nombre: "Belleza de Manos", minutos: 45, lista: 36250, efectivo: 29000 },
      { nombre: "Esmaltado Semi Permanente Manos", minutos: 60, lista: 48750, efectivo: 39000 },
      { nombre: "Cambio de Esmalte Común en Manos", minutos: 30, lista: 30000, efectivo: 24000 },
      { nombre: "Kapping de Nivelación", minutos: 75, lista: 50000, efectivo: 40000 },
      { nombre: "Kapping Acrigel / Acrílico", minutos: 90, lista: 56250, efectivo: 45000 },
      { nombre: "Service de Kapping Acrigel", minutos: 90, lista: 55000, efectivo: 44000 },
      { nombre: "Kapping Baby Boomer", minutos: 90, lista: 65000, efectivo: 52000 },
      { nombre: "Esculpidas", minutos: 120, lista: 72500, efectivo: 58000 },
      { nombre: "Service de Esculpidas", minutos: 90, lista: 61250, efectivo: 49000 },
      { nombre: "Esculpidas Baby Boomer", minutos: 120, lista: 78750, efectivo: 63000 },
      { nombre: "Soft Gel", minutos: 90, lista: 61250, efectivo: 49000 },
      { nombre: "Service Soft", minutos: 75, lista: 51250, efectivo: 41000 },
      { nombre: "Retirado de Manos Semi", minutos: 20, lista: 13750, efectivo: 11000 },
      { nombre: "Retirado de Kapping", minutos: 30, lista: 16250, efectivo: 13000 },
      { nombre: "Retirado de Esculpidas / Soft gel", minutos: 30, lista: 18750, efectivo: 15000 },
      { nombre: "Esculpidas Pies / Manos (por uña)", minutos: 15, lista: 16250, efectivo: 13000 },
      { nombre: "Belleza de Pies", minutos: 60, lista: 43750, efectivo: 35000 },
      { nombre: "Cambio de Esmalte Común en Pies", minutos: 30, lista: 36250, efectivo: 29000 },
      { nombre: "Esmaltado Semi Permanente Pies", minutos: 45, lista: 50000, efectivo: 40000 },
      { nombre: "Pedicuria Damas sin Esmaltar", minutos: 60, lista: 57500, efectivo: 46000 },
      { nombre: "Pedicuria + Esmaltado Común", minutos: 75, lista: 63750, efectivo: 51000 },
      { nombre: "Pedicuria + Semi Permanente", minutos: 75, lista: 72500, efectivo: 58000 },
      { nombre: "Pedicuria Caballeros", minutos: 60, lista: 72500, efectivo: 58000 },
      { nombre: "Uñas Esculpidas en Pies", minutos: 90, lista: 71250, efectivo: 57000 },
      { nombre: "Retirado de Pies Semi Permanente", minutos: 20, lista: 16250, efectivo: 13000 },
      { nombre: "Parche", minutos: 15, lista: 11250, efectivo: 9000 },
      { nombre: "Parafina", minutos: 15, lista: 16250, efectivo: 13000 },
      { nombre: "French / Francesitas", minutos: 15, lista: 8750, efectivo: 7000 },
      { nombre: "Decoración de Uñas por Mano", minutos: 15, lista: 11250, efectivo: 9000 },
      { nombre: "Efectos / Ojo de gato / Aura / Cromo", minutos: 15, lista: 8750, efectivo: 7000 },
      { nombre: "Belleza de Manos Kids", minutos: 30, lista: 17500, efectivo: 14000 },
      { nombre: "Belleza de Pies Kids", minutos: 30, lista: 22500, efectivo: 18000 },
    ],
  },
  {
    nombre: "Cejas y Pestañas", universo: "TRATAMIENTOS", antes: ["Cejas y Pestañas", "Cejas & Pestañas"], servicios: [
      { nombre: "Perfilado de Cejas con Hilo / Pinza / Cera", minutos: 30, lista: 26250, efectivo: 21000 },
      { nombre: "Laminado / Alisado de Cejas", minutos: 60, lista: 37500, efectivo: 30000 },
      { nombre: "Tinte de Cejas", minutos: 20, lista: 12500, efectivo: 10000 },
      { nombre: "Botox de Cejas / Pestañas", minutos: 30, lista: 10000, efectivo: 8000 },
      { nombre: "Permanente y Tinte de Pestañas / Lifting", minutos: 60, lista: 46250, efectivo: 37000 },
    ],
  },
  {
    nombre: "Depilación con Cera", universo: "TRATAMIENTOS", antes: ["Depilación con Cera", "Depilación"], servicios: [
      { nombre: "Pierna Entera", minutos: 40, lista: 20000, efectivo: 16000 },
      { nombre: "1/2 Pierna", minutos: 25, lista: 16250, efectivo: 13000 },
      { nombre: "Axilas", minutos: 15, lista: 16250, efectivo: 13000 },
      { nombre: "Brazo", minutos: 20, lista: 17500, efectivo: 14000 },
      { nombre: "Cavado Profundo", minutos: 25, lista: 17500, efectivo: 14000 },
      { nombre: "Cavado", minutos: 20, lista: 13750, efectivo: 11000 },
      { nombre: "Tira de Cola", minutos: 10, lista: 13750, efectivo: 11000 },
      { nombre: "Glúteos", minutos: 15, lista: 12500, efectivo: 10000 },
      { nombre: "1/2 Pelvis", minutos: 20, lista: 16250, efectivo: 13000 },
      { nombre: "Bozo", minutos: 10, lista: 10000, efectivo: 8000 },
      { nombre: "Nariz / Orejas / Patillas", minutos: 10, lista: 10000, efectivo: 8000 },
      { nombre: "Pómulos", minutos: 10, lista: 17500, efectivo: 14000 },
      { nombre: "Mentón", minutos: 10, lista: 7500, efectivo: 6000 },
      { nombre: "Abdomen", minutos: 15, lista: 13750, efectivo: 11000 },
      { nombre: "Espalda Mujer", minutos: 20, lista: 17500, efectivo: 14000 },
      { nombre: "Espalda Hombre", minutos: 30, lista: 28750, efectivo: 23000 },
    ],
  },
];
