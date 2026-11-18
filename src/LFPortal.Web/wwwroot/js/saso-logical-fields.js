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

  function groupName(name, definitions = []) {
    const normalized = String(name ?? "").trim();
    for (const group of definitions)
      if ([group.name, ...(group.templates ?? [])].some(value =>
        String(value ?? "").trim().toLowerCase() === normalized.toLowerCase())) return group.name;
    return isSaso(normalized) ? "SASO" : normalized;
  }

  function enrichRows(rows, fields, definitions = []) {
    if (!Array.isArray(rows) || !Array.isArray(fields))
      return { rows, aliasCount: 0, conflicts: [], aliasesByTemplate: {} };
    const grouped = new Map();
    for (const row of rows ?? []) {
      const physical = row?.originalTemplate ?? row?.template;
      const name = groupName(physical, definitions);
      if (!isSaso(physical) && !definitions.some(group => canonicalName(group.name) === canonicalName(name)))
        continue;
      if (!grouped.has(name)) grouped.set(name, []);
      grouped.get(name).push(row);
    }
    const aliasesByTemplate = Object.create(null);
    const replacements = new Map();
    let aliasCount = 0;
    const conflicts = [];
    for (const [name, family] of grouped) {
      const result = enrichFamily(family, fields);
      aliasCount += result.aliasCount;
      conflicts.push(...result.conflicts.map(field => name + " · " + field));
      aliasesByTemplate[name] = result.aliases;
      family.forEach((row, index) => replacements.set(row, result.rows[index]));
    }
    return {
      rows: (rows ?? []).map(row => replacements.get(row) ?? row),
      aliasCount, conflicts, aliasesByTemplate
    };
  }

  function enrichFamily(rows, fields) {
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

    const family = rows;
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
        if (hasValue(row.fields[id])) templateFields.get(meta.name).add(id);
        // Empty alternate IDs returned with metadata do not make a field ambiguous.
        if (hasValue(row.fields[id]))
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
      if (!row.fields || typeof row.fields !== "object" || Array.isArray(row.fields))
        return row;

      let next;
      for (const ids of aliases) {
        const present = ids.filter(id => hasValue(row.fields[id]));
        if (present.length !== 1) continue;
        const value = row.fields[present[0]];
        for (const id of ids) {
          if (hasValue(row.fields[id])) continue;
          next ??= { ...row.fields };
          next[id] = Array.isArray(value) ? [...value] : value;
          aliasCount++;
        }
      }
      return next ? { ...row, fields: next } : row;
    });

    return { rows: enriched, aliasCount, conflicts: [...blocked].sort(), aliases };
  }

  function hasValue(value) {
    return Array.isArray(value) ? value.some(item => String(item ?? "").trim()) :
      value !== null && value !== undefined && String(value).trim() !== "";
  }

  const api = Object.freeze({ enrichRows, isSaso, groupName });
  if (host) host.SasoDashboardFields = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : null);
