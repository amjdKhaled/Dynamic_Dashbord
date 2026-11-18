/*
 * SASO dashboard-only logical field aliases.
 * No Laserfiche writes, security changes, API calls or browser DOM modifications.
 * Only copies values already present in the authenticated dashboard Rows response.
 */
(function (host) {
  "use strict";

  const SASO = /^SASO(?:\s*\(\s*[1-6]\s*\)|\s+[1-6])?$/i;

  const isSaso = name => SASO.test(String(name ?? "").trim());
  const canonicalName = name => String(name ?? "")
    .normalize("NFKC")
    .replace(/[\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu, "")
    .replace(/\s+/gu, " ").trim().toLocaleLowerCase("en");
  const canonicalType = field => String(field?.type ?? "").trim().toLowerCase() +
    "|" + String(Boolean(field?.multi));

  function enrichRows(rows, fields) {
    if (!Array.isArray(rows) || !Array.isArray(fields))
      return { rows, aliasCount: 0, conflicts: [] };

    const catalog = new Map(fields.filter(field =>
      field && field.id !== null && field.id !== undefined &&
      String(field.id).trim() && canonicalName(field.name)
    ).map(field => [String(field.id), {
      name: canonicalName(field.name),
      type: canonicalType(field),
      typeKnown: Boolean(String(field.type ?? "").trim())
    }]));

    const family = rows.filter(row => isSaso(row?.originalTemplate ?? row?.template));
    const groups = new Map();
    const perTemplate = new Map();
    const blocked = new Set();

    for (const row of family) {
      if (!row.fields || typeof row.fields !== "object" || Array.isArray(row.fields))
        continue;

      const physicalTemplate = canonicalName(row.originalTemplate ?? row.template);
      const templateFields = perTemplate.get(physicalTemplate) ?? new Map();
      perTemplate.set(physicalTemplate, templateFields);
      const inDocument = new Map();

      for (const id of Object.keys(row.fields)) {
        const meta = catalog.get(id);
        if (!meta) continue;
        if (!groups.has(meta.name)) groups.set(meta.name, new Set());
        groups.get(meta.name).add(id);

        if (!templateFields.has(meta.name)) templateFields.set(meta.name, new Set());
        templateFields.get(meta.name).add(id);
        inDocument.set(meta.name, (inDocument.get(meta.name) ?? 0) + 1);
      }
      for (const [name, count] of inDocument)
        if (count > 1) blocked.add(name);
    }

    // Identical display names are not sufficient evidence if a physical template
    // has multiple definitions for that name, or field schemas disagree.
    for (const templateFields of perTemplate.values())
      for (const [name, ids] of templateFields)
        if (ids.size > 1) blocked.add(name);

    const aliases = [];
    for (const [name, idSet] of groups) {
      const ids = [...idSet];
      if (ids.length < 2) continue;
      const signatures = new Set(ids.map(id => catalog.get(id)?.type));
      if (signatures.size !== 1 || ids.some(id => !catalog.get(id)?.typeKnown)) {
        blocked.add(name);
        continue;
      }
      if (!blocked.has(name)) aliases.push(ids);
    }

    let aliasCount = 0;
    const enriched = rows.map(row => {
      if (!isSaso(row?.originalTemplate ?? row?.template) ||
          !row.fields || typeof row.fields !== "object" || Array.isArray(row.fields))
        return row;

      let next;
      for (const ids of aliases) {
        const present = ids.filter(id => Object.hasOwn(row.fields, id));
        if (present.length !== 1) continue;
        const value = row.fields[present[0]];
        for (const id of ids) {
          if (Object.hasOwn(row.fields, id)) continue;
          next ??= { ...row.fields };
          next[id] = Array.isArray(value) ? [...value] : value;
          aliasCount++;
        }
      }
      return next ? { ...row, fields: next } : row;
    });

    return { rows: enriched, aliasCount, conflicts: [...blocked].sort() };
  }

  const api = Object.freeze({ enrichRows, isSaso });
  if (host) host.SasoDashboardFields = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : null);
