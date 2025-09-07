import { useState, useEffect, createContext, useContext } from "react";

interface AuthContextType {
  isAuthenticated: boolean;
  user: string | null;
  login: (username: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<string | null>(null);

  useEffect(() => {
    // Check if user is already authenticated
    const authStatus = localStorage.getItem("isAuthenticated");
    const authenticatedUser = localStorage.getItem("authenticatedUser");
    
    if (authStatus === "true" && authenticatedUser) {
      setIsAuthenticated(true);
      setUser(authenticatedUser);
    }
  }, []);

  const login = (username: string) => {
    console.log("Login called with username:", username);
    localStorage.setItem("isAuthenticated", "true");
    localStorage.setItem("authenticatedUser", username);
    setIsAuthenticated(true);
    setUser(username);
    console.log("Auth state updated - isAuthenticated: true, user:", username);
  };

  const logout = () => {
    localStorage.removeItem("isAuthenticated");
    localStorage.removeItem("authenticatedUser");
    setIsAuthenticated(false);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};