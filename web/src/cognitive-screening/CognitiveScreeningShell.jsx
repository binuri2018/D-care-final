import { Link, Outlet } from "react-router-dom";

export default function CognitiveScreeningShell() {
  return (
    <div className="screening-integrated">
      <div className="screening-back">
        <Link to="/">← Memory Aid home</Link>
      </div>
      <Outlet />
    </div>
  );
}
