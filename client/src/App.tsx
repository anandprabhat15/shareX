import { Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import SessionPage from "./pages/SessionPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/s/:id" element={<SessionPage />} />
    </Routes>
  );
}
