// src/pages/Analytics.jsx
import React, { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend
} from 'recharts';
import { format, subDays } from 'date-fns';

const CHART_COLORS = [
  '#1a6bb8', '#3d8cc9', '#2d8a8a', '#5a8eb8', '#6b9eac', '#4a7eb8', '#5c7a9a',
];
const CHART_GRID = 'rgba(26, 58, 95, 0.08)';
const CHART_TICK = '#5a6f82';
const tooltipStyle = {
  background: '#ffffff',
  border: '1px solid rgba(26, 58, 95, 0.15)',
  borderRadius: 8,
  color: '#1a3348',
  boxShadow: '0 8px 24px rgba(26, 43, 66, 0.08)',
};

export default function Analytics({ reminders }) {
  const stats = useMemo(() => {
    const total = reminders.length;
    const completed = reminders.filter(r => r.completed).length;
    const overdue = reminders.filter(r => !r.completed && new Date(r.dueDate) < new Date()).length;
    const upcoming = reminders.filter(r => !r.completed && new Date(r.dueDate) >= new Date()).length;

    // By category
    const categoryMap = {};
    reminders.forEach(r => {
      categoryMap[r.category] = (categoryMap[r.category] || 0) + 1;
    });
    const byCategory = Object.entries(categoryMap).map(([name, value]) => ({ name, value }));

    // By priority
    const priorityMap = { high: 0, medium: 0, low: 0 };
    reminders.forEach(r => { priorityMap[r.priority || 'medium']++; });
    const byPriority = Object.entries(priorityMap).map(([name, value]) => ({ name: name.charAt(0).toUpperCase()+name.slice(1), value }));

    // Last 7 days creation
    const last7 = Array.from({ length: 7 }, (_, i) => {
      const day = subDays(new Date(), 6 - i);
      const dayStr = format(day, 'MMM d');
      const count = reminders.filter(r => {
        const cd = r.createdAt?.toDate ? r.createdAt.toDate() : new Date(r.createdAt?.seconds * 1000 || Date.now());
        return format(cd, 'MMM d') === dayStr;
      }).length;
      const doneCount = reminders.filter(r => {
        const cd = r.createdAt?.toDate ? r.createdAt.toDate() : new Date(r.createdAt?.seconds * 1000 || Date.now());
        return format(cd, 'MMM d') === dayStr && r.completed;
      }).length;
      return { day: dayStr, created: count, completed: doneCount };
    });

    // Completion rate by category
    const completionByCategory = Object.entries(categoryMap).map(([cat]) => {
      const catReminders = reminders.filter(r => r.category === cat);
      const rate = catReminders.length > 0
        ? Math.round((catReminders.filter(r => r.completed).length / catReminders.length) * 100)
        : 0;
      return { name: cat, rate };
    });

    return { total, completed, overdue, upcoming, byCategory, byPriority, last7, completionByCategory };
  }, [reminders]);

  const completionRate = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

  return (
    <div className="analytics-page">
      <h1 className="page-title">📊 Analytics Dashboard</h1>

      {/* KPI Cards */}
      <div className="kpi-grid">
        <div className="kpi-card kpi-total">
          <div className="kpi-icon">📋</div>
          <div className="kpi-value">{stats.total}</div>
          <div className="kpi-label">Total Reminders</div>
        </div>
        <div className="kpi-card kpi-done">
          <div className="kpi-icon">✅</div>
          <div className="kpi-value">{stats.completed}</div>
          <div className="kpi-label">Completed</div>
        </div>
        <div className="kpi-card kpi-overdue">
          <div className="kpi-icon">⚠️</div>
          <div className="kpi-value">{stats.overdue}</div>
          <div className="kpi-label">Overdue</div>
        </div>
        <div className="kpi-card kpi-upcoming">
          <div className="kpi-icon">🔮</div>
          <div className="kpi-value">{stats.upcoming}</div>
          <div className="kpi-label">Upcoming</div>
        </div>
        <div className="kpi-card kpi-rate">
          <div className="kpi-icon">🎯</div>
          <div className="kpi-value">{completionRate}%</div>
          <div className="kpi-label">Completion Rate</div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${completionRate}%` }} />
          </div>
        </div>
      </div>

      {/* Charts Row 1 */}
      <div className="charts-grid">
        <div className="chart-card">
          <h3>Activity (Last 7 Days)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={stats.last7}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
              <XAxis dataKey="day" tick={{ fill: CHART_TICK, fontSize: 12 }} />
              <YAxis tick={{ fill: CHART_TICK, fontSize: 12 }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend />
              <Line type="monotone" dataKey="created" stroke="#1a6bb8" strokeWidth={2} dot={{ fill: '#1a6bb8' }} name="Created" />
              <Line type="monotone" dataKey="completed" stroke="#2d8a8a" strokeWidth={2} dot={{ fill: '#2d8a8a' }} name="Completed" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>By Category</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={stats.byCategory} cx="50%" cy="50%" outerRadius={80}
                dataKey="value" nameKey="name" label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`}
                labelLine={{ stroke: 'rgba(26, 58, 95, 0.2)' }}>
                {stats.byCategory.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="charts-grid">
        <div className="chart-card">
          <h3>By Priority</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={stats.byPriority} barSize={40}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
              <XAxis dataKey="name" tick={{ fill: CHART_TICK, fontSize: 12 }} />
              <YAxis tick={{ fill: CHART_TICK, fontSize: 12 }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="value" name="Count">
                {stats.byPriority.map((entry, i) => {
                  const c = entry.name === 'High' ? '#b54a4a' : entry.name === 'Medium' ? '#9a7b2c' : '#2d8a8a';
                  return <Cell key={i} fill={c} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Completion Rate by Category</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={stats.completionByCategory} barSize={32}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
              <XAxis dataKey="name" tick={{ fill: CHART_TICK, fontSize: 11 }} />
              <YAxis tick={{ fill: CHART_TICK, fontSize: 12 }} domain={[0, 100]} unit="%" />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${v}%`} />
              <Bar dataKey="rate" name="Rate %">
                {stats.completionByCategory.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
