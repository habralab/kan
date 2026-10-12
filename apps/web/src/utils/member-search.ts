export const filterMemberOptions = <T extends { value: string }>(
  members: T[],
  query: string,
) => {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  if (!normalizedQuery) return members;

  return members.filter((member) =>
    member.value.toLocaleLowerCase().includes(normalizedQuery),
  );
};
