export interface UserContext {
  userId: string;
  email?: string;
  name?: string;
  role?: string;
  authorities: string[];
}
