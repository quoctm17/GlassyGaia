/**
 * Static welcome overlay data — rendered immediately, then refreshed in background.
 * Update these values whenever new content is added to the database.
 */

export const WELCOME_STATS = {
  totalMediaCards: 262197,
  totalContentItems: 137,
  levelDistribution: [
    {
      framework: 'CEFR',
      language: 'en' as string | null,
      levels: { A1: 4593.2, A2: 2423.1, B1: 2413.8, B2: 2559.4, C1: 1352.6, C2: 357 } as Record<string, number>,
      totalCount: 819,
    },
  ],
};

export const WELCOME_RECENT_ITEMS = [
  {
    id: 'barbie_a_touch_of_magic_s1',
    title: 'Barbie A Touch of Magic (Season 1)',
    cover_url: 'https://pub-3567da72191244fbbde455e3800854f2.r2.dev/items/barbie_a_touch_of_magic_s1/cover_image/cover.jpg',
    num_cards: 4127,
  },
  {
    id: 'hilda_s3',
    title: 'Hilda (Season 3)',
    cover_url: 'https://pub-3567da72191244fbbde455e3800854f2.r2.dev/items/hilda_s3/cover_image/cover.jpg',
    num_cards: 1727,
  },
  {
    id: 'hilda_s2',
    title: 'Hilda (Season 2)',
    cover_url: 'https://pub-3567da72191244fbbde455e3800854f2.r2.dev/items/hilda_s2/cover_image/cover.jpg',
    num_cards: 3651,
  },
  {
    id: 'hilda_s1',
    title: 'Hilda (Season 1)',
    cover_url: 'https://pub-3567da72191244fbbde455e3800854f2.r2.dev/items/hilda_s1/cover_image/cover.jpg',
    num_cards: 3418,
  },
  {
    id: '13_reasons_why_s2',
    title: '13 Reasons Why (Season 2)',
    cover_url: 'https://pub-3567da72191244fbbde455e3800854f2.r2.dev/items/13_reasons_why_s2/cover_image/cover.jpg',
    num_cards: 7625,
  },
  {
    id: '13_reasons_why_s1',
    title: '13 Reasons Why (Season 1)',
    cover_url: 'https://pub-3567da72191244fbbde455e3800854f2.r2.dev/items/13_reasons_why_s1/cover_image/cover.jpg',
    num_cards: 9769,
  },
  {
    id: 'ted_ed_s13_you_are_what_you_eat',
    title: 'TED-Ed - You Are What You Eat',
    cover_url: 'https://pub-3567da72191244fbbde455e3800854f2.r2.dev/items/ted_ed_s13_you_are_what_you_eat/cover_image/cover.jpg',
    num_cards: 674,
  },
  {
    id: 'ted_ed_s12_facing_our_ugly_history',
    title: 'TED-Ed - Facing our ugly history',
    cover_url: 'https://pub-3567da72191244fbbde455e3800854f2.r2.dev/items/ted_ed_s12_facing_our_ugly_history/cover_image/cover.jpg',
    num_cards: 709,
  },
  {
    id: 'mona_lisa_smile_001',
    title: 'Mona Lisa Smile',
    cover_url: 'https://pub-3567da72191244fbbde455e3800854f2.r2.dev/items/mona_lisa_smile_001/cover_image/cover.jpg',
    num_cards: 1378,
  },
];
