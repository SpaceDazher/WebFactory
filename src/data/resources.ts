// v1.10: ресурсы и настройки генерации карты — данными (моды меняют их операцией patch; добавлять новые виды ресурсов пока нельзя).
// richness — множитель запасов, size — множитель размера стартовых пятен; карта: деревья, скалы, общий множитель руды.
// Значения по умолчанию (1) дают ровно ту же карту, что и до v1.10.
export interface ResourceDef { id: string; /** номер в чанке (Chunk.res) */ res: number; richness: number; size: number; }
export interface MapGenDef { id: string; trees: number; rocks: number; richness: number; }
export const RESOURCES: Record<string, ResourceDef> = {
  'iron-ore': { id: 'iron-ore', res: 1, richness: 1, size: 1 },
  'copper-ore': { id: 'copper-ore', res: 2, richness: 1, size: 1 },
  'coal': { id: 'coal', res: 3, richness: 1, size: 1 },
  'stone': { id: 'stone', res: 4, richness: 1, size: 1 },
  'crude-oil': { id: 'crude-oil', res: 5, richness: 1, size: 1 },
  'uranium-ore': { id: 'uranium-ore', res: 6, richness: 1, size: 1 },
};
export const MAPGEN: Record<string, MapGenDef> = { default: { id: 'default', trees: 1, rocks: 1, richness: 1 } };
