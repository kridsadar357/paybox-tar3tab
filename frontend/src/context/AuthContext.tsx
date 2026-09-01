import React, { createContext, useContext, useState, useEffect } from 'react';

type Role = 'admin' | 'customer' | 'none';
export type RouteRole = 'admin' | 'customer' | 'any';

// SPA เดียวกันถูกเสิร์ฟทั้งที่ /portal/administrator และ /customer (ดู server.ts) — ต้องแยกด้วย path
// จริงตอน runtime ไม่ใช่แค่ UI tab เพราะ sessionStorage/localStorage ใช้ร่วมกันทั้ง origin ถ้าไม่เช็ค
// path ตรงนี้ด้วย session ฝั่ง customer ที่ค้างอยู่จะ auto-restore บนหน้า admin ได้ (และกลับกัน)
export function getRouteRole(): RouteRole {
  const path = window.location.pathname;
  if (path.startsWith('/portal/administrator')) return 'admin';
  if (path.startsWith('/customer')) return 'customer';
  return 'any';
}

interface AuthContextType {
  role: Role;
  adminToken: string;
  customerToken: string;
  setRole: (role: Role) => void;
  loginAdmin: (token: string) => void;
  loginCustomer: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  role: 'none',
  adminToken: '',
  customerToken: '',
  setRole: () => {},
  loginAdmin: () => {},
  loginCustomer: () => {},
  logout: () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [role, setRoleState] = useState<Role>('none');
  const [adminToken, setAdminToken] = useState<string>('');
  const [customerToken, setCustomerToken] = useState<string>('');

  useEffect(() => {
    // Check saved tokens on mount — จำกัดตาม route จริง กันเซสชันของอีก role มา auto-restore ผิดหน้า
    const routeRole = getRouteRole();
    const savedAdminToken = sessionStorage.getItem('paybox_admin_token');
    const savedCustToken = localStorage.getItem('paybox_customer_token');

    if (routeRole !== 'customer' && savedAdminToken) {
      setAdminToken(savedAdminToken);
      setRoleState('admin');
    } else if (routeRole !== 'admin' && savedCustToken) {
      setCustomerToken(savedCustToken);
      setRoleState('customer');
    }
  }, []);

  // token ที่รับเข้ามาต้องผ่านการเช็ค admin_password กับ POST /api/admin/login มาแล้วเท่านั้น
  // (เรียกจาก LoginPage หลัง API ตอบ success — ไม่ใช่การเก็บ raw password อีกต่อไป)
  const loginAdmin = (token: string) => {
    sessionStorage.setItem('paybox_admin_token', token);
    setAdminToken(token);
    setRoleState('admin');
  };

  const loginCustomer = (token: string) => {
    localStorage.setItem('paybox_customer_token', token);
    setCustomerToken(token);
    setRoleState('customer');
  };

  const logout = () => {
    sessionStorage.removeItem('paybox_admin_token');
    localStorage.removeItem('paybox_customer_token');
    setAdminToken('');
    setCustomerToken('');
    setRoleState('none');
  };

  return (
    <AuthContext.Provider
      value={{
        role,
        adminToken,
        customerToken,
        setRole: setRoleState,
        loginAdmin,
        loginCustomer,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
