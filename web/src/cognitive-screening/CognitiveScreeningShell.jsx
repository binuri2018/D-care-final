import { Link, Outlet } from "react-router-dom";

export default function CognitiveScreeningShell() {
  return (
    <div className="screening-integrated">
      <div className="screening-back">
        <Link to="/">← D-care home</Link>
      </div>
      <Outlet />
    </div>
  );
}
