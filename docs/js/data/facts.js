export const FACTS = {
  authors: {
    "traian-dorz": {
      name: "Traian Dorz",
      aliases: ["traian dorz", "dorz"],
      born: 1914,
      died: 1989,
      role: "poet și mărturisitor al Oastei Domnului",
      articleCount: 8978,
      notes: [
        "Este asociat în mod deosebit cu poezia, suferința, mărturisirea și cântarea creștină.",
        "Nu inventa date, locuri, citate sau episoade biografice care nu sunt prezente în context.",
      ],
    },
    "pr-iosif-trifa": {
      name: "Pr. Iosif Trifa",
      aliases: ["iosif trifa", "pr. iosif trifa", "preotul iosif trifa", "trifa"],
      born: 1888,
      died: 1938,
      role: "fondatorul Oastei Domnului",
      articleCount: 1726,
      foundedMovementYear: 1923,
      recurringThemes: [
        "nașterea din nou",
        "pocăința vie",
        "lupta împotriva păcatului",
        "citirea și trăirea Scripturii",
        "mărturisirea lui Hristos",
        "trezirea spirituală a poporului credincios",
      ],
    },
    "arcadie-nistor": { name: "Arcadie Nistor", aliases: ["arcadie nistor"], born: 1924, died: 2006, articleCount: 54 },
    "popa-petru-saucani": { name: "Popa Petru Săucani", aliases: ["popa petru săucani", "popa petru saucani"], born: 1918, died: 1985, articleCount: 31 },
    "popa-petru-batiz": { name: "Popa Petru Batiz", aliases: ["popa petru batiz"], born: 1915, died: 1983, articleCount: 26 },
    "ioan-marini": { name: "Ioan Marini", aliases: ["ioan marini"], born: 1908, died: 1947, articleCount: 25 },
    "ioan-opris": { name: "Ioan Opriș", aliases: ["ioan opriș", "ioan opris"], born: 1907, died: 1996, articleCount: 24 },
  },
  movements: {
    "oastea-domnului": {
      name: "Oastea Domnului",
      aliases: ["oastea domnului", "oastea"],
      foundedYear: 1923,
      founder: "Pr. Iosif Trifa",
      founderSlug: "pr-iosif-trifa",
      confirmedFacts: [
        "Oastea Domnului a fost fondată în anul 1923.",
        "Fondatorul Oastei Domnului este Pr. Iosif Trifa.",
      ],
      unknowns: [
        "Baza factuală locală nu confirmă o zi și o lună exacte pentru «prima zi istorică».",
        "Nu trebuie inventată o dată completă pentru un eveniment dacă ea nu apare în contextul articolului selectat.",
      ],
    },
  },
};

export function factsAsPromptBlock() {
  const authors = Object.values(FACTS.authors)
    .map((a) => `- ${a.name}: ${a.born || "?"}–${a.died || "?"}${a.role ? `, ${a.role}` : ""}${a.articleCount ? `, ${a.articleCount} articole` : ""}`)
    .join("\n");

  const od = FACTS.movements["oastea-domnului"];

  return `DATE FACTUALE LOCALE CONFIRMATE:\n${authors}\n- ${od.name}: fondată în ${od.foundedYear}, fondator ${od.founder}.\n- Nu există în baza factuală locală o zi/lună confirmată pentru «prima zi istorică» a Oastei Domnului.`;
}
