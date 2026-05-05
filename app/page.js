"use client";

import { useEffect, useMemo, useState } from "react";
import { Line } from "react-chartjs-2";
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend } from "chart.js";
import { supabase } from "@/lib/supabase";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

const MEAL_TAGS = ["breakfast", "lunch", "snack", "dinner", "other"];
const DEFAULT_CALORIE_PLAN = {1:2560,2:2623,3:2686,4:2749,5:2811,6:2874,7:2937,8:3000,9:3000,10:3000,11:3000,12:3000,13:3000,14:3000,15:3000,16:3000};

const todayISO = () => new Date().toISOString().slice(0, 10);
const timeNow = () => new Date().toTimeString().slice(0, 5);
const r2 = (n) => Number(Number(n).toFixed(2));
const pretty = (n, comma = false) => {
  const v = Number(n);
  if (Number.isInteger(v)) return comma ? v.toLocaleString() : String(v);
  return comma
    ? v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : v.toFixed(2);
};
const num = (n, u = "") => (n == null || Number.isNaN(n) ? "-" : `${Number(n).toFixed(2)} ${u}`.trim());

export default function Page() {
  const [tab, setTab] = useState("dashboard");
  const [weight, setWeight] = useState([]);
  const [calories, setCalories] = useState([]);
  const [activeCalories, setActiveCalories] = useState([]);
  const [msg, setMsg] = useState("");
  const [bwMsg, setBwMsg] = useState("");
  const [calMsg, setCalMsg] = useState("");
  const [activeMsg, setActiveMsg] = useState("");
  const [caloriePlan, setCaloriePlan] = useState(DEFAULT_CALORIE_PLAN);

  const [weightForm, setWeightForm] = useState({ date: todayISO(), weight_kg: "73.0", notes: "" });
  const [calForm, setCalForm] = useState({ date: todayISO(), time: timeNow(), meal_tag: "breakfast", calories: "400", notes: "" });
  const [activeForm, setActiveForm] = useState({ date: todayISO(), time: timeNow(), calories: "350", notes: "" });

  async function loadData() {
    if (!supabase) return setMsg("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const [w, c, a, t] = await Promise.all([
      supabase.from("bodyweight_log").select("date,weight_kg,notes").order("date"),
      supabase.from("calorie_log").select("date,time,meal_tag,calories,notes").order("date").order("time"),
      supabase.from("active_calorie_log").select("date,time,calories,notes").order("date").order("time"),
      supabase.from("weekly_calorie_targets").select("week_number,target_calories").order("week_number"),
    ]);
    if (w.error || c.error || a.error || t.error) return setMsg(w.error?.message || c.error?.message || a.error?.message || t.error?.message || "Error loading data");
    setWeight(w.data || []);
    setCalories(c.data || []);
    setActiveCalories(a.data || []);
    if (t.data?.length) {
      const plan = t.data.reduce((acc, row) => {
        acc[row.week_number] = Number(row.target_calories);
        return acc;
      }, {});
      setCaloriePlan(plan);
    }
  }

  useEffect(() => { loadData(); }, []);

  const model = useMemo(() => compute(weight, calories, activeCalories, caloriePlan), [weight, calories, activeCalories, caloriePlan]);

  async function addWeight(e) {
    e.preventDefault();
    setBwMsg("");
    if (!supabase) return setBwMsg("Supabase env vars are missing.");
    if (!weightForm.date || !weightForm.weight_kg) return setBwMsg("Please enter date and weight.");
    const { error } = await supabase.from("bodyweight_log").insert({ ...weightForm, weight_kg: Number(weightForm.weight_kg) });
    if (error) return setBwMsg(error.message);
    setWeightForm({ date: todayISO(), weight_kg: "73.0", notes: "" });
    setBwMsg("Bodyweight entry saved.");
    loadData();
  }

  async function addCalories(e) {
    e.preventDefault();
    setCalMsg("");
    if (!supabase) return setCalMsg("Supabase env vars are missing.");
    if (!calForm.date || !calForm.calories) return setCalMsg("Please enter date and calories.");
    const { error } = await supabase.from("calorie_log").insert({ ...calForm, calories: Number(calForm.calories) });
    if (error) return setCalMsg(error.message);
    setCalForm({ date: todayISO(), time: timeNow(), meal_tag: "breakfast", calories: "400", notes: "" });
    setCalMsg("Calorie entry saved.");
    loadData();
  }

  async function addActiveCalories(e) {
    e.preventDefault();
    setActiveMsg("");
    if (!supabase) return setActiveMsg("Supabase env vars are missing.");
    if (!activeForm.date || !activeForm.calories) return setActiveMsg("Please enter date and calories.");
    const { error } = await supabase.from("active_calorie_log").insert({ ...activeForm, calories: Number(activeForm.calories) });
    if (error) return setActiveMsg(error.message);
    setActiveForm({ date: todayISO(), time: timeNow(), calories: "350", notes: "" });
    setActiveMsg("Active calorie entry saved.");
    loadData();
  }

  return (
    <main>
      <h1>16-Week Weight Gain Tracker</h1>
      <p className="muted">Warm Journal Theme · Next.js + Supabase</p>

      <div className="tabs">
        {[
          ["dashboard", "Dashboard & Charts"],
          ["body", "Bodyweight Entry"],
          ["calorie", "Calorie Entry"],
          ["active", "Active Calories Entry"],
          ["data", "Data"],
        ].map(([k, label]) => <button key={k} className={`tab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>{label}</button>)}
      </div>

      <div className="card">
        {msg && <p className="muted">{msg}</p>}

        <section className={`panel ${tab === "dashboard" ? "active" : ""}`}>
          <h3>{`Progress Snapshot - Week ${model.currentWeek}`}</h3>
          <div className="grid-4">
            <Metric l="Today&apos;s Target" v={`${model.todayTarget} kcal`} />
            <Metric l="Today&apos;s Calories" v={num(model.todayCalories, "kcal")} />
            <Metric l="Calories Left" v={num(model.caloriesLeft, "kcal")} />
            <Metric l="Active Calories" v={num(model.todayActiveCalories, "kcal")} />
            <Metric l="Latest Weight" v={num(model.latestWeight, "kg")} />
            <Metric l="7-Day Avg Weight" v={num(model.avg7, "kg")} />
            <Metric l="Avg Daily Calories" v={num(model.avgCal, "kcal")} />
            <Metric l="Vs Target" v={num(model.diff, "kcal")} />
          </div>
          <div className="info">{model.guidance}</div>
          <div className="sp" />
          <h3>Progress Charts</h3>
          <p className="muted">Daily bodyweight and 7-day average</p>
          <WeightChart data={model.weightChart} />
          <div className="sp" />
          <p className="muted">Daily calories vs target</p>
          <CalorieChart data={model.calorieChart} />
          <div className="sp" />
          <p className="muted">Weekly target calories (from first bodyweight entry date)</p>
          <WeeklyTargetChart data={model.weeklyTargetChart} />
        </section>

        <section className={`panel ${tab === "body" ? "active" : ""}`}>
          <h3>Log Bodyweight</h3>
          <form onSubmit={addWeight}>
            <div className="grid">
              <input type="date" value={weightForm.date} onChange={(e) => setWeightForm({ ...weightForm, date: e.target.value })} />
              <input type="number" step="0.1" min="30" max="250" placeholder="Weight (kg)" value={weightForm.weight_kg} onChange={(e) => setWeightForm({ ...weightForm, weight_kg: e.target.value })} />
              <textarea placeholder="Notes" value={weightForm.notes} onChange={(e) => setWeightForm({ ...weightForm, notes: e.target.value })} />
              <div />
            </div>
            <div className="sp" />
            <button type="submit">Save Bodyweight</button>
            <p className="muted">{bwMsg}</p>
          </form>
        </section>

        <section className={`panel ${tab === "calorie" ? "active" : ""}`}>
          <h3>Log Calories</h3>
          <form onSubmit={addCalories}>
            <div className="grid">
              <input type="date" value={calForm.date} onChange={(e) => setCalForm({ ...calForm, date: e.target.value })} />
              <input type="time" value={calForm.time} onChange={(e) => setCalForm({ ...calForm, time: e.target.value })} />
              <select value={calForm.meal_tag} onChange={(e) => setCalForm({ ...calForm, meal_tag: e.target.value })}>{MEAL_TAGS.map((m) => <option key={m}>{m}</option>)}</select>
              <input type="number" min="1" max="5000" step="1" placeholder="Calories" value={calForm.calories} onChange={(e) => setCalForm({ ...calForm, calories: e.target.value })} />
              <textarea placeholder="Notes" value={calForm.notes} onChange={(e) => setCalForm({ ...calForm, notes: e.target.value })} />
              <div />
            </div>
            <div className="sp" />
            <button type="submit">Add Calorie Entry</button>
            <p className="muted">{calMsg}</p>
          </form>
        </section>

        <section className={`panel ${tab === "active" ? "active" : ""}`}>
          <h3>Log Active Calories</h3>
          <form onSubmit={addActiveCalories}>
            <div className="grid">
              <input type="date" value={activeForm.date} onChange={(e) => setActiveForm({ ...activeForm, date: e.target.value })} />
              <input type="time" value={activeForm.time} onChange={(e) => setActiveForm({ ...activeForm, time: e.target.value })} />
              <input type="number" min="1" max="5000" step="1" placeholder="Active Calories" value={activeForm.calories} onChange={(e) => setActiveForm({ ...activeForm, calories: e.target.value })} />
              <textarea placeholder="Notes" value={activeForm.notes} onChange={(e) => setActiveForm({ ...activeForm, notes: e.target.value })} />
              <div />
            </div>
            <div className="sp" />
            <button type="submit">Add Active Calorie Entry</button>
            <p className="muted">{activeMsg}</p>
          </form>
        </section>

        <section className={`panel ${tab === "data" ? "active" : ""}`}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>Logs</h3>
            <span className="pill">Supabase data</span>
          </div>
          <h4>Bodyweight Log</h4>
          <Table rows={[...weight].sort((a, b) => b.date.localeCompare(a.date))} cols={["date", "weight_kg", "notes"]} />
          <h4>Calorie Log</h4>
          <Table rows={[...calories].sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`))} cols={["date", "time", "meal_tag", "calories", "notes"]} />
          <h4>Active Calorie Log</h4>
          <Table rows={[...activeCalories].sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`))} cols={["date", "time", "calories", "notes"]} />
          <div className="sp" />
          <div className="row">
            <button onClick={() => download("bodyweight_log.csv", toCSV(weight))}>Download Bodyweight CSV</button>
            <button onClick={() => download("calorie_log.csv", toCSV(calories))}>Download Calorie CSV</button>
            <button onClick={() => download("active_calorie_log.csv", toCSV(activeCalories))}>Download Active Calorie CSV</button>
          </div>
        </section>
      </div>
    </main>
  );
}

function Metric({ l, v }) { return <div className="metric"><div className="l">{l}</div><div className="v">{v}</div></div>; }

function WeightChart({ data }) {
  if (!data.length) return <p className="muted">No data yet.</p>;
  const labels = data.map((d) => d.date);
  const daily = data.map((d) => (d.weight_kg == null ? null : r2(d.weight_kg)));
  const avg7 = data.map((d) => (d.weight_7d_avg == null ? null : r2(d.weight_7d_avg)));
  const vals = [...daily, ...avg7].filter((v) => v != null);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return (
    <div style={{ height: 430 }}>
      <Line
        data={{
          labels,
          datasets: [
            { label: "Daily weight", data: daily, borderColor: "#c26d10", backgroundColor: "transparent", pointRadius: 2.5, tension: 0.25 },
            { label: "7-day avg", data: avg7, borderColor: "#6d321d", backgroundColor: "transparent", pointRadius: 2.5, tension: 0.25 },
          ],
        }}
        options={baseChartOptions({ min: min - 0.1, max: max + 0.1 })}
      />
    </div>
  );
}

function CalorieChart({ data }) {
  if (!data.length) return <p className="muted">No data yet.</p>;
  const labels = data.map((d) => d.date);
  const daily = data.map((d) => (d.daily_calories == null ? null : r2(d.daily_calories)));
  const target = data.map((d) => (d.target_calories == null ? null : r2(d.target_calories)));
  const vals = [...daily, ...target].filter((v) => v != null);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return (
    <div style={{ height: 300 }}>
      <Line
        data={{
          labels,
          datasets: [
            { label: "Daily calories", data: daily, borderColor: "#2f9a47", backgroundColor: "transparent", pointRadius: 2.5, tension: 0.25 },
            { label: "Target", data: target, borderColor: "#b25f1b", backgroundColor: "transparent", pointRadius: 2.5, borderDash: [6, 4], tension: 0 },
          ],
        }}
        options={baseChartOptions({ min: Math.max(0, min - 150), max: max + 150, comma: true })}
      />
    </div>
  );
}

function WeeklyTargetChart({ data }) {
  if (!data.length) return <p className="muted">No target data yet.</p>;
  const labels = data.map((d) => `W${d.week} (${d.date})`);
  const target = data.map((d) => (d.target_calories == null ? null : r2(d.target_calories)));
  const vals = target.filter((v) => v != null);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return (
    <div style={{ height: 300 }}>
      <Line
        data={{
          labels,
          datasets: [
            { label: "Weekly target", data: target, borderColor: "#b25f1b", backgroundColor: "transparent", pointRadius: 2.5, tension: 0.2 },
          ],
        }}
        options={baseChartOptions({ min: Math.max(0, min - 150), max: max + 150, comma: true })}
      />
    </div>
  );
}

function baseChartOptions({ min, max, comma = false }) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { position: "top", align: "center", labels: { boxWidth: 40, boxHeight: 12, color: "#4b5563" } },
      tooltip: {
        enabled: true,
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${pretty(ctx.parsed.y, false)}`,
        },
      },
    },
    scales: {
      x: { grid: { color: "rgba(120,120,120,0.15)" }, ticks: { color: "#4b5563", maxRotation: 0, autoSkip: true } },
      y: {
        min,
        max,
        grid: { color: "rgba(120,120,120,0.15)" },
        ticks: {
          color: "#4b5563",
          callback: (v) => pretty(v, comma),
        },
      },
    },
  };
}

function Table({ rows, cols }) {
  if (!rows.length) return <p className="muted">No entries yet.</p>;
  return <table><thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}>{r[c] ?? ""}</td>)}</tr>)}</tbody></table>;
}

function compute(weightRows, calorieRows, activeRows, caloriePlan) {
  const ws = [...weightRows].sort((a, b) => a.date.localeCompare(b.date));
  const cs = [...calorieRows].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const as = [...activeRows].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const planStart = ws[0]?.date || cs[0]?.date || as[0]?.date || todayISO();
  const week = getWeek(planStart, todayISO());
  const baseTarget = caloriePlan[week] ?? DEFAULT_CALORIE_PLAN[week];

  const vals = ws.map((x) => Number(x.weight_kg));
  const latestWeight = vals.length ? vals[vals.length - 1] : null;
  const avg7 = vals.length >= 7 ? avg(vals.slice(-7)) : null;
  const prev7 = vals.length >= 14 ? avg(vals.slice(-14, -7)) : null;
  const weeklyChange = avg7 != null && prev7 != null ? avg7 - prev7 : null;

  const dmap = {};
  cs.forEach((r) => { dmap[r.date] = (dmap[r.date] || 0) + Number(r.calories || 0); });
  const daily = Object.entries(dmap).map(([date, daily_calories]) => ({ date, daily_calories })).sort((a, b) => a.date.localeCompare(b.date));
  const amap = {};
  as.forEach((r) => { amap[r.date] = (amap[r.date] || 0) + Number(r.calories || 0); });
  const todayCalories = dmap[todayISO()] ?? 0;
  const todayActiveCalories = amap[todayISO()] ?? 0;
  const todayTarget = baseTarget + todayActiveCalories;
  const caloriesLeft = todayTarget - todayCalories;
  const thisWeek = daily.filter((d) => getWeek(planStart, d.date) === week);
  const avgCal = thisWeek.length ? avg(thisWeek.map((x) => x.daily_calories)) : null;
  const diff = avgCal != null ? avgCal - baseTarget : null;

  let guidance = "Not enough bodyweight entries yet for a reliable adjustment.";
  if (weeklyChange != null) {
    if (weeklyChange < 0.25) guidance = "Gain is under 0.25 kg/week. Consider +150 to +200 kcal/day.";
    else if (weeklyChange <= 0.5) guidance = "Gain is in the ideal 0.25–0.5 kg/week range.";
    else if (weeklyChange > 0.7) guidance = "Gain is above 0.7 kg/week. Consider reducing ~150 kcal/day.";
    else guidance = "Progress is acceptable. Keep intake consistent.";
  }

  const weightChart = ws.map((w, i) => ({ ...w, weight_7d_avg: i >= 6 ? avg(vals.slice(i - 6, i + 1)) : null }));
  const calorieChart = daily.map((d) => ({ ...d, target_calories: (caloriePlan[getWeek(planStart, d.date)] ?? DEFAULT_CALORIE_PLAN[getWeek(planStart, d.date)]) + (amap[d.date] ?? 0) }));
  const weeklyTargetChart = Array.from({ length: 16 }, (_, i) => {
    const weekNum = i + 1;
    const d = new Date(planStart);
    d.setDate(d.getDate() + i * 7);
    return {
      week: weekNum,
      date: d.toISOString().slice(0, 10),
      target_calories: caloriePlan[weekNum] ?? DEFAULT_CALORIE_PLAN[weekNum],
    };
  });

  return { currentWeek: week, todayTarget, todayCalories, todayActiveCalories, caloriesLeft, latestWeight, avg7, prev7, weeklyChange, avgCal, diff, guidance, weightChart, calorieChart, weeklyTargetChart };
}

function getWeek(planStart, dateStr) {
  const days = Math.floor((new Date(dateStr) - new Date(planStart)) / 86400000);
  return Math.max(1, Math.min(16, Math.floor(days / 7) + 1));
}

const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

function toCSV(rows) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  return [keys.join(","), ...rows.map((r) => keys.map((k) => `"${String(r[k] ?? "").replaceAll('"', '""')}"`).join(","))].join("\n");
}

function download(filename, text) {
  const blob = new Blob([text], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
