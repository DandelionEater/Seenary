type LibraryReply<T> = {
  ok: boolean;
  entries?: T[];
};

export type LibraryHydration<TAnime, TManga> = {
  animeEntries?: TAnime[];
  mangaEntries?: TManga[];
  failed: boolean;
};

function entriesFrom<T>(result: PromiseSettledResult<LibraryReply<T>>): T[] | undefined {
  if (result.status === "rejected" || !result.value.ok) {
    return undefined;
  }

  return result.value.entries || [];
}

export function resolveLibraryHydration<TAnime, TManga>(
  animeResult: PromiseSettledResult<LibraryReply<TAnime>>,
  mangaResult: PromiseSettledResult<LibraryReply<TManga>>
): LibraryHydration<TAnime, TManga> {
  const animeEntries = entriesFrom(animeResult);
  const mangaEntries = entriesFrom(mangaResult);

  return {
    animeEntries,
    mangaEntries,
    failed: animeEntries === undefined || mangaEntries === undefined,
  };
}
