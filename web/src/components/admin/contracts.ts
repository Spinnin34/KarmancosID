export type AdminUser = {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  secondLastName: string;
  displayName: string;
  role: "USER" | "ADMIN";
  active: boolean;
  createdAt: string;
  picture: string | null;
};

export type AccountFilter = "all" | "active" | "blocked" | "admin";
