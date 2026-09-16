export type User = {
  name: string | null;
  displayName: string | null;
  email: string | null;
  id: string | null;
  owner: string | null;
};

export type MeResponse = {
  user: User;
  claims: Record<string, unknown>;
  expiresAt: number | null;
};

export type CardAccent = "violet" | "blue" | "emerald" | "amber" | "rose";

export type Project = {
  id: string;
  index: string;
  title: string;
  description: string;
  accent: CardAccent;
  updatedAt: string;
  manager: string;
};
