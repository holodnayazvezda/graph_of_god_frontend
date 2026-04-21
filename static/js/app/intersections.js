function combinations(items, size) {
  const result = [];

  function walk(startIndex, current) {
    if (current.length === size) {
      result.push([...current]);
      return;
    }

    for (let index = startIndex; index < items.length; index += 1) {
      current.push(items[index]);
      walk(index + 1, current);
      current.pop();
    }
  }

  walk(0, []);
  return result;
}

export function buildIntersectionGroups(result) {
  const nodeById = new Map(result.nodes.map((node) => [node.node_id, node]));
  const groups = new Map();

  result.nodes
    .filter((node) => !node.is_seed && node.connected_seed_indices.length >= 2)
    .forEach((node) => {
      const sortedSeedIndices = [...node.connected_seed_indices].sort((left, right) => left - right);
      for (let size = 2; size <= sortedSeedIndices.length; size += 1) {
        for (const subset of combinations(sortedSeedIndices, size)) {
          const key = `subset:${subset.join("-")}`;
          if (!groups.has(key)) {
            groups.set(key, {
              key,
              seedIndices: subset,
              nodeIds: [],
            });
          }
          groups.get(key).nodeIds.push(node.node_id);
        }
      }
    });

  return [...groups.values()]
    .map((group) => {
      const uniqueNodeIds = [...new Set(group.nodeIds)];
      const previewNames = uniqueNodeIds
        .slice(0, 6)
        .map((nodeId) => nodeById.get(nodeId)?.full_name)
        .filter(Boolean);

      return {
        ...group,
        nodeIds: uniqueNodeIds,
        sharedCount: uniqueNodeIds.length,
        title: `Профили ${group.seedIndices.map((seedIndex) => `#${seedIndex + 1}`).join(" × ")}`,
        shortSeedLabel: group.seedIndices.map((seedIndex) => `#${seedIndex + 1}`).join(" · "),
        kindLabel: intersectionKindLabel(group.seedIndices.length),
        previewNames,
        remainingCount: Math.max(0, uniqueNodeIds.length - previewNames.length),
      };
    })
    .sort((left, right) => {
      if (left.seedIndices.length !== right.seedIndices.length) {
        return right.seedIndices.length - left.seedIndices.length;
      }
      if (left.sharedCount !== right.sharedCount) {
        return right.sharedCount - left.sharedCount;
      }
      return left.key.localeCompare(right.key);
    });
}

export function intersectionKindLabel(seedCount) {
  if (seedCount === 2) return "Попарное";
  if (seedCount === 3) return "Тройное";
  if (seedCount === 4) return "Четверное";
  if (seedCount === 5) return "Пятикратное";
  return `${seedCount}-кратное`;
}

export function sourceLabel(sourceKind) {
  if (sourceKind === "friends") return "Источник: друзья";
  if (sourceKind === "followers") return "Источник: подписчики";
  return "Источник: приватный профиль";
}
