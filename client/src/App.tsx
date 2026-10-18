import { Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import SessionPage from "./pages/SessionPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      {/* Short links like /9807; /s/:id keeps older links working. */}
      <Route path="/s/:id" element={<SessionPage />} />
      <Route path="/:id" element={<SessionPage />} />
    </Routes>
  );
}
