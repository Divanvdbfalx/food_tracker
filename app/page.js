"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Line } from "react-chartjs-2";
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler } from "chart.js";
import { supabase } from "@/lib/supabase";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

const MEAL_TAGS = ["breakfast", "lunch", "dinner", "snack"];
const DEFAULT_CALORIE_PLAN = {1:2560,2:2623,3:2686,4:2749,5:2811,6:2874,7:2937,8:3000,9:3000,10:3000,11:3000,12:3000,13:3000,14:3000,15:3000,16:3000};
const STREAK_KEY = "food-tracker-active-streak-v1";
const SAVED_STREAKS_KEY = "food-tracker-saved-streaks-v1";

const todayISO = () => new Date().toISOString().slice(0, 10);
const timeNow = () => new Date().toTimeString().slice(0, 5);
const mealTagFromTime = (time) => {
  const [h, m] = time.split(":").map(Number);
  const minutes = h * 60 + m;
  if (minutes < 9 * 60) return "breakfast";
  if (minutes >= 11 * 60 && minutes <= 15 * 60) return "lunch";
  if (minutes >= 18 * 60 && minutes <= 21 * 60) return "dinner";
  return "snack";
};
const r2 = (n) => Number(Number(n).toFixed(2));
const pretty = (n, comma = false) => {
  const v = Number(n);
  if (Number.isInteger(v)) return comma ? v.toLocaleString() : String(v);
  return comma
    ? v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : v.toFixed(2);
};
const num = (n, u = "") => (n == null || Number.isNaN(n) ? "-" : `${Number(n).toFixed(2)} ${u}`.trim());
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

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
  const [showLast7Days, setShowLast7Days] = useState(false);
  const [savedStreaks, setSavedStreaks] = useState([]);
  const [activeStreak, setActiveStreak] = useState(() => makeDefaultStreak());
  const [streakForm, setStreakForm] = useState(() => makeDefaultStreak());
  const [streakMsg, setStreakMsg] = useState("");

  const [weightForm, setWeightForm] = useState({ date: todayISO(), weight_kg: "73.0", notes: "" });
  const [calForm, setCalForm] = useState({ date: todayISO(), time: timeNow(), meal_tag: mealTagFromTime(timeNow()), calories: "400", protein_g: "30", notes: "" });
  const [activeForm, setActiveForm] = useState({ date: todayISO(), time: timeNow(), calories: "350", notes: "" });

  const [photoPreview, setPhotoPreview] = useState(null);
  const [foodDesc, setFoodDesc] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeMsg, setAnalyzeMsg] = useState("");
  const photoInputRef = useRef(null);

  async function loadData() {
    if (!supabase) return setMsg("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const [w, c, a, t] = await Promise.all([
      supabase.from("bodyweight_log").select("date,weight_kg,notes").order("date"),
      supabase.from("calorie_log").select("date,time,meal_tag,calories,protein_g,notes").order("date").order("time"),
      supabase.from("active_calorie_log").select("date,time,calories,notes").order("date").order("time"),
      supabase.from("weekly_calorie_targets").select("week_number,target_calories").order("week_number"),
    ]);
    if (w.error || c.error || a.error || t.error) return setMsg(w.error?.message || c.error?.message || a.error?.message || t.error?.message || "Error loading data");
    setWeight(w.data || []);
    setCalories(c.data || []);
    setActiveCalories(a.data || []);
    const hasStoredStreak = typeof window !== "undefined" && window.localStorage.getItem(STREAK_KEY);
    if (t.data?.length && !hasStoredStreak) {
      const plan = t.data.reduce((acc, row) => {
        acc[row.week_number] = Number(row.target_calories);
        return acc;
      }, {});
      setCaloriePlan(plan);
    }
  }

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    const storedStreak = readStoredJSON(STREAK_KEY, null);
    const storedSaved = readStoredJSON(SAVED_STREAKS_KEY, []);
    if (storedStreak) {
      const hydrated = normalizeStreak(storedStreak);
      setActiveStreak(hydrated);
      setStreakForm(hydrated);
      setCaloriePlan(hydrated.caloriePlan);
    }
    if (Array.isArray(storedSaved)) setSavedStreaks(storedSaved);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STREAK_KEY, JSON.stringify(activeStreak));
  }, [activeStreak]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SAVED_STREAKS_KEY, JSON.stringify(savedStreaks));
  }, [savedStreaks]);

  const model = useMemo(() => compute(weight, calories, activeCalories, caloriePlan, activeStreak), [weight, calories, activeCalories, caloriePlan, activeStreak]);

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
    const logTime = timeNow();
    const { error } = await supabase.from("calorie_log").insert({ ...calForm, time: logTime, calories: Number(calForm.calories), protein_g: Number(calForm.protein_g || 0) });
    if (error) return setCalMsg(error.message);
    const nextTime = timeNow();
    setCalForm({ date: todayISO(), time: nextTime, meal_tag: mealTagFromTime(nextTime), calories: "400", protein_g: "30", notes: "" });
    setCalMsg("Calorie entry saved.");
    loadData();
  }

  function handlePhotoSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target.result);
    reader.readAsDataURL(file);
    setAnalyzeMsg("");
    e.target.value = "";
  }

  async function analyzeFood() {
    if (!photoPreview) return;
    setAnalyzing(true);
    setAnalyzeMsg("");
    try {
      const res = await fetch("/api/analyze-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: photoPreview, description: foodDesc }),
      });
      const data = await res.json();
      if (data.error) {
        setAnalyzeMsg(`Error: ${data.error}`);
      } else {
        setCalForm((prev) => ({
          ...prev,
          calories: String(data.calories || prev.calories),
          protein_g: String(data.protein_g || prev.protein_g),
          notes: data.description || prev.notes,
        }));
        setAnalyzeMsg("Estimated from photo — review and save.");
      }
    } catch {
      setAnalyzeMsg("Failed to analyze photo. Try again.");
    } finally {
      setAnalyzing(false);
    }
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

  function updateStreakField(field, value) {
    setStreakMsg("");
    setStreakForm((prev) => {
      if (field !== "horizonWeeks") return { ...prev, [field]: value };
      const horizonWeeks = clamp(Number(value || 1), 1, 52);
      return { ...prev, horizonWeeks, caloriePlan: resizePlan(prev.caloriePlan, horizonWeeks) };
    });
  }

  function updateStreakPlan(nextPlan) {
    setStreakMsg("");
    setStreakForm((prev) => ({ ...prev, caloriePlan: resizePlan(nextPlan, prev.horizonWeeks) }));
  }

  function applyStreakPlan() {
    const next = normalizeStreak(streakForm);
    if (!next.startDate || !next.startWeightKg || !next.endWeightKg) {
      setStreakMsg("Please set a start date, start weight, and end weight.");
      return;
    }
    setActiveStreak(next);
    setCaloriePlan(next.caloriePlan);
    setTab("dashboard");
    setStreakMsg("New streak started from day one.");
  }

  function saveAndStartNewStreak() {
    const archived = buildSavedStreak(activeStreak, model, weight, calories, activeCalories);
    setSavedStreaks((prev) => [archived, ...prev].slice(0, 20));
    const next = normalizeStreak(streakForm);
    setActiveStreak(next);
    setCaloriePlan(next.caloriePlan);
    setTab("dashboard");
    setStreakMsg("Previous streak saved. New streak started from day one.");
  }

  return (
    <main>
      <h1>Weight Streak Tracker</h1>
      <p className="muted">Warm Journal Theme · Next.js + Supabase</p>

      <div className="tabs">
        {[
          ["dashboard", "Dashboard & Charts"],
          ["body", "Bodyweight Entry"],
          ["calorie", "Calorie Entry"],
          ["active", "Active Calories Entry"],
          ["streak", "Streak Planner"],
          ["data", "Data"],
        ].map(([k, label]) => <button key={k} className={`tab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>{label}</button>)}
      </div>

      <div className="card">
        {msg && <p className="muted">{msg}</p>}

        <section className={`panel ${tab === "dashboard" ? "active" : ""}`}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <div>
              <h3 style={{ margin: 0 }}>{`Progress Snapshot - Week ${model.currentWeek}`}</h3>
              <p className="muted compact">{`Active streak: ${activeStreak.startDate} to ${model.targetEndDate} · ${pretty(activeStreak.startWeightKg)} kg to ${pretty(activeStreak.endWeightKg)} kg`}</p>
            </div>
            <button type="button" className="secondary-btn" onClick={() => setTab("streak")}>Plan Streak</button>
          </div>
          <div className="grid-4">
            <Metric l="Today&apos;s Target" v={`${model.todayTarget} kcal`} />
            <Metric l="Today&apos;s Calories" v={num(model.todayCalories, "kcal")} />
            <Metric l="Calories Left" v={num(model.caloriesLeft, "kcal")} />
            <Metric l="Today&apos;s Protein" v={num(model.todayProtein, "g")} />
            <Metric l="Active Calories" v={num(model.todayActiveCalories, "kcal")} />
            <Metric l="Latest Weight" v={num(model.latestWeight, "kg")} />
            <Metric l="7-Day Avg Weight" v={num(model.avg7, "kg")} />
            <Metric l="Weekly Weight Change" v={num(model.weeklyChange, "kg/week")} />
          </div>
          <div className="info">{model.guidance}</div>
          <div className="sp" />
          <h3>Progress Charts</h3>
          <button
            type="button"
            className={`chart-toggle-btn ${showLast7Days ? "on" : ""}`}
            onClick={() => setShowLast7Days((v) => !v)}
            aria-pressed={showLast7Days}
            title="Toggle last 7 days"
          >
            <span className="chart-toggle-switch" aria-hidden="true">
              <span className="chart-toggle-knob" />
            </span>
            <span className="chart-toggle-label">Last 7 days</span>
          </button>
          <div className="sp" />
          <p className="muted">Daily bodyweight and 7-day average</p>
          <WeightChart data={filterLast7Days(model.weightChart, showLast7Days)} />
          <div className="sp" />
          <p className="muted">Daily calories vs target</p>
          <CalorieChart data={filterLast7Days(model.calorieChart, showLast7Days)} />
          <div className="sp" />
          <p className="muted">Daily protein</p>
          <ProteinChart data={filterLast7Days(model.calorieChart, showLast7Days)} />
          <div className="sp" />
          <p className="muted">Weekly target calories for the active streak</p>
          <WeeklyTargetChart data={model.weeklyTargetChart} currentWeek={model.currentWeek} />
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
            <div className="photo-section">
              <input ref={photoInputRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={handlePhotoSelect} />
              <button type="button" className="secondary-btn photo-pick-btn" onClick={() => photoInputRef.current?.click()}>
                Take / choose photo
              </button>
              {photoPreview && (
                <div className="photo-preview-row">
                  <img src={photoPreview} alt="Food" className="food-thumb" />
                  <div className="photo-desc-col">
                    <label className="field-label">
                      Description (optional)
                      <input type="text" placeholder="e.g. chicken rice bowl" value={foodDesc} onChange={(e) => setFoodDesc(e.target.value)} />
                    </label>
                    <button type="button" className="analyze-btn" onClick={analyzeFood} disabled={analyzing}>
                      {analyzing ? "Analyzing…" : "Estimate macros"}
                    </button>
                  </div>
                </div>
              )}
              {analyzeMsg && <p className="muted analyze-msg">{analyzeMsg}</p>}
            </div>
            <div className="sp" />
            <div className="grid">
              <input className="full-width" type="date" value={calForm.date} onChange={(e) => setCalForm({ ...calForm, date: e.target.value })} />
              <div className="meal-tags" role="radiogroup" aria-label="Meal type">
                {MEAL_TAGS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`meal-tag ${calForm.meal_tag === m ? "active" : ""}`}
                    onClick={() => setCalForm({ ...calForm, meal_tag: m })}
                    aria-pressed={calForm.meal_tag === m}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <label className="field-label">
                Calories
                <input type="number" min="1" max="5000" step="1" value={calForm.calories} onChange={(e) => setCalForm({ ...calForm, calories: e.target.value })} />
              </label>
              <label className="field-label">
                Protein (g)
                <input type="number" min="0" max="500" step="1" value={calForm.protein_g} onChange={(e) => setCalForm({ ...calForm, protein_g: e.target.value })} />
              </label>
              <textarea className="full-width" placeholder="Notes" value={calForm.notes} onChange={(e) => setCalForm({ ...calForm, notes: e.target.value })} />
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

        <section className={`panel ${tab === "streak" ? "active" : ""}`}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <div>
              <h3 style={{ margin: 0 }}>Streak Planner</h3>
              <p className="muted compact">Save the current streak, choose a fresh start, then drag the calorie target line.</p>
            </div>
            <span className="pill">{`Day ${model.streakDay}`}</span>
          </div>
          <div className="grid">
            <label className="field-label">
              Start date
              <input type="date" value={streakForm.startDate} onChange={(e) => updateStreakField("startDate", e.target.value)} />
            </label>
            <label className="field-label">
              Horizon (weeks)
              <input type="number" min="1" max="52" step="1" value={streakForm.horizonWeeks} onChange={(e) => updateStreakField("horizonWeeks", e.target.value)} />
            </label>
            <label className="field-label">
              Start weight (kg)
              <input type="number" min="30" max="250" step="0.1" value={streakForm.startWeightKg} onChange={(e) => updateStreakField("startWeightKg", e.target.value)} />
            </label>
            <label className="field-label">
              End weight (kg)
              <input type="number" min="30" max="250" step="0.1" value={streakForm.endWeightKg} onChange={(e) => updateStreakField("endWeightKg", e.target.value)} />
            </label>
          </div>
          <div className="sp" />
          <div className="planner-summary">
            <Metric l="Target End Date" v={addDays(streakForm.startDate, Number(streakForm.horizonWeeks || 1) * 7 - 1)} />
            <Metric l="Weight Goal" v={`${pretty(Number(streakForm.endWeightKg || 0) - Number(streakForm.startWeightKg || 0))} kg`} />
            <Metric l="Weeks Planned" v={String(streakForm.horizonWeeks || 1)} />
          </div>
          <div className="sp" />
          <p className="muted">Drag the orange points up or down to shape weekly calorie targets.</p>
          <EditableWeeklyTargetChart
            startDate={streakForm.startDate}
            horizonWeeks={Number(streakForm.horizonWeeks || 1)}
            caloriePlan={streakForm.caloriePlan}
            onChange={updateStreakPlan}
          />
          <div className="sp" />
          <div className="row">
            <button type="button" onClick={applyStreakPlan}>Start New Streak</button>
            <button type="button" className="secondary-btn" onClick={saveAndStartNewStreak}>Save Current Streak & Start New</button>
          </div>
          <p className="muted">{streakMsg}</p>
          <div className="sp" />
          <h4>Saved Streaks</h4>
          {savedStreaks.length ? (
            <div className="saved-streaks">
              {savedStreaks.map((s) => (
                <div className="saved-streak" key={s.id}>
                  <strong>{`${s.startDate} to ${s.endDate}`}</strong>
                  <span>{`${s.startWeightKg} kg to ${s.latestWeightKg ?? "-"} kg · ${s.daysLogged} logged days`}</span>
                </div>
              ))}
            </div>
          ) : <p className="muted">No saved streaks yet.</p>}
        </section>

        <section className={`panel ${tab === "data" ? "active" : ""}`}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>Logs</h3>
            <span className="pill">Supabase data</span>
          </div>
          <h4>Bodyweight Log</h4>
          <Table rows={[...weight].sort((a, b) => b.date.localeCompare(a.date))} cols={["date", "weight_kg", "notes"]} />
          <h4>Calorie Log</h4>
          <Table rows={[...calories].sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`))} cols={["date", "time", "meal_tag", "calories", "protein_g", "notes"]} />
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
            {
              label: "7-day avg",
              data: avg7,
              borderColor: "#6d321d",
              backgroundColor: "transparent",
              pointRadius: 2.5,
              tension: 0.25,
              segment: {
                borderDash: (ctx) => {
                  const lastSevenStartIndex = Math.max(6, data.length - 7);
                  return ctx.p0DataIndex >= lastSevenStartIndex && ctx.p1DataIndex >= lastSevenStartIndex ? [] : [6, 4];
                },
              },
            },
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

  const calVals = [...daily, ...target].filter((v) => v != null);
  const calMin = calVals.length ? Math.max(0, Math.min(...calVals) - 150) : 0;
  const calMax = calVals.length ? Math.max(...calVals) + 150 : 3500;

  return (
    <div style={{ height: 320 }}>
      <Line
        data={{
          labels,
          datasets: [
            { label: "Target", data: target, borderColor: "#b25f1b", backgroundColor: "transparent", pointRadius: 2.5, borderDash: [6, 4], tension: 0.18 },
            {
              label: "Above target area",
              data: daily.map((v, i) => (v != null && target[i] != null ? Math.max(v, target[i]) : null)),
              borderColor: "rgba(0,0,0,0)",
              backgroundColor: "rgba(34,197,94,0.22)",
              pointRadius: 0,
              tension: 0.18,
              spanGaps: true,
              fill: 0,
            },
            {
              label: "Below target area",
              data: daily.map((v, i) => (v != null && target[i] != null ? Math.min(v, target[i]) : null)),
              borderColor: "rgba(0,0,0,0)",
              backgroundColor: "rgba(239,68,68,0.22)",
              pointRadius: 0,
              tension: 0.18,
              spanGaps: true,
              fill: 0,
            },
            { label: "Daily calories", data: daily, borderColor: "#2f9a47", backgroundColor: "transparent", pointRadius: 2.5, tension: 0.18 },
          ],
        }}
        options={{
          ...baseChartOptions({ min: calMin, max: calMax, comma: true }),
          plugins: {
            ...baseChartOptions({ min: calMin, max: calMax, comma: true }).plugins,
            legend: {
              ...baseChartOptions({ min: calMin, max: calMax, comma: true }).plugins.legend,
              labels: {
                ...baseChartOptions({ min: calMin, max: calMax, comma: true }).plugins.legend.labels,
                filter: (item) => !["Above target area", "Below target area"].includes(item.text),
              },
            },
            tooltip: {
              ...baseChartOptions({ min: calMin, max: calMax, comma: true }).plugins.tooltip,
              filter: (ctx) => !["Above target area", "Below target area"].includes(ctx.dataset.label),
            },
          },
        }}
      />
    </div>
  );
}

function ProteinChart({ data }) {
  if (!data.length) return <p className="muted">No data yet.</p>;
  const labels = data.map((d) => d.date);
  const protein = data.map((d) => (d.daily_protein == null ? null : r2(d.daily_protein)));

  const proteinVals = protein.filter((v) => v != null);
  const pMin = proteinVals.length ? Math.max(0, Math.min(...proteinVals, 130) - 20) : 0;
  const pMax = proteinVals.length ? Math.max(...proteinVals, 160) + 20 : 220;

  const proteinLowerBand = labels.map(() => 130);
  const proteinUpperBand = labels.map(() => 160);

  return (
    <div style={{ height: 320 }}>
      <Line
        data={{
          labels,
          datasets: [
            { label: "Protein lower", data: proteinLowerBand, borderColor: "rgba(79,70,229,0)", backgroundColor: "transparent", pointRadius: 0, tension: 0, fill: false },
            { label: "Protein target range", data: proteinUpperBand, borderColor: "rgba(79,70,229,0)", backgroundColor: "rgba(79,70,229,0.14)", pointRadius: 0, tension: 0, fill: "-1" },
            { label: "Daily protein", data: protein, borderColor: "#4f46e5", backgroundColor: "transparent", pointRadius: 2.5, tension: 0.25 },
          ],
        }}
        options={{
          ...baseChartOptions({ min: pMin, max: pMax }),
          plugins: {
            ...baseChartOptions({ min: pMin, max: pMax }).plugins,
            legend: {
              ...baseChartOptions({ min: pMin, max: pMax }).plugins.legend,
              labels: {
                ...baseChartOptions({ min: pMin, max: pMax }).plugins.legend.labels,
                filter: (item) => !["Protein lower", "Protein target range"].includes(item.text),
              },
            },
          },
        }}
      />
    </div>
  );
}

function WeeklyTargetChart({ data, currentWeek }) {
  if (!data.length) return <p className="muted">No target data yet.</p>;
  const labels = data.map((d) => `W${d.week} (${d.date})`);
  const target = data.map((d) => (d.target_calories == null ? null : r2(d.target_calories)));
  const avgWeekCalories = data.map((d) => (d.avg_week_calories == null ? null : r2(d.avg_week_calories)));
  const vals = [...target, ...avgWeekCalories].filter((v) => v != null);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return (
    <div style={{ height: 300 }}>
      <Line
        data={{
          labels,
          datasets: [
            { label: "Weekly target", data: target, borderColor: "#b25f1b", backgroundColor: "transparent", pointRadius: (ctx) => (data[ctx.dataIndex]?.week === currentWeek ? 6 : 2.5), pointHoverRadius: (ctx) => (data[ctx.dataIndex]?.week === currentWeek ? 7 : 4), tension: 0.2 },
            { label: "Avg daily calories (week)", data: avgWeekCalories, borderColor: "#2f9a47", backgroundColor: "transparent", pointRadius: 2.5, borderDash: [5, 4], tension: 0.2 },
          ],
        }}
        options={baseChartOptions({ min: Math.max(0, min - 150), max: max + 150, comma: true })}
      />
    </div>
  );
}

function EditableWeeklyTargetChart({ startDate, horizonWeeks, caloriePlan, onChange }) {
  const chartRef = useRef(null);
  const dragIndexRef = useRef(null);
  const weeks = Math.max(1, Number(horizonWeeks || 1));
  const data = Array.from({ length: weeks }, (_, i) => {
    const week = i + 1;
    return {
      week,
      date: addDays(startDate, i * 7),
      target_calories: Number(caloriePlan[week] ?? 3000),
    };
  });
  const target = data.map((d) => d.target_calories);
  const min = Math.max(0, Math.min(...target) - 250);
  const max = Math.max(...target) + 250;

  function updatePoint(event) {
    const chart = chartRef.current;
    const index = dragIndexRef.current;
    if (!chart || index == null) return;
    const rect = chart.canvas.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const value = Math.round(chart.scales.y.getValueForPixel(y) / 25) * 25;
    const next = { ...caloriePlan, [index + 1]: clamp(value, 1000, 6000) };
    onChange(next);
  }

  return (
    <div
      className="editable-chart"
      onPointerDown={(event) => {
        const chart = chartRef.current;
        if (!chart) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        const rect = chart.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const rawIndex = chart.scales.x.getValueForPixel(x);
        dragIndexRef.current = clamp(Math.round(Number(rawIndex)), 0, weeks - 1);
        updatePoint(event);
      }}
      onPointerMove={updatePoint}
      onPointerUp={() => { dragIndexRef.current = null; }}
      onPointerLeave={() => { dragIndexRef.current = null; }}
    >
      <Line
        ref={chartRef}
        data={{
          labels: data.map((d) => `W${d.week} (${d.date})`),
          datasets: [
            {
              label: "Planned calories",
              data: target,
              borderColor: "#b25f1b",
              backgroundColor: "rgba(178,95,27,0.12)",
              pointRadius: 7,
              pointHoverRadius: 8,
              tension: 0.2,
              fill: true,
            },
          ],
        }}
        options={{
          ...baseChartOptions({ min, max, comma: true }),
          onHover: (event, elements) => {
            if (chartRef.current?.canvas) chartRef.current.canvas.style.cursor = elements.length ? "grab" : "crosshair";
          },
        }}
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
      x: { grid: { color: "rgba(120,120,120,0.15)" }, ticks: { color: "#4b5563", maxRotation: 45, minRotation: 45, autoSkip: true } },
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

function makeDefaultStreak() {
  return normalizeStreak({
    startDate: todayISO(),
    startWeightKg: "73.0",
    endWeightKg: "78.0",
    horizonWeeks: 16,
    caloriePlan: DEFAULT_CALORIE_PLAN,
  });
}

function normalizeStreak(streak = {}) {
  const horizonWeeks = clamp(Number(streak.horizonWeeks || 16), 1, 52);
  const startDate = streak.startDate || todayISO();
  return {
    startDate,
    startWeightKg: String(streak.startWeightKg ?? "73.0"),
    endWeightKg: String(streak.endWeightKg ?? "78.0"),
    horizonWeeks,
    caloriePlan: resizePlan(streak.caloriePlan || DEFAULT_CALORIE_PLAN, horizonWeeks),
  };
}

function resizePlan(plan, weeks) {
  const next = {};
  const safeWeeks = clamp(Number(weeks || 1), 1, 52);
  for (let i = 1; i <= safeWeeks; i += 1) {
    next[i] = Number(plan?.[i] ?? plan?.[String(i)] ?? DEFAULT_CALORIE_PLAN[Math.min(i, 16)] ?? next[i - 1] ?? 3000);
  }
  return next;
}

function buildSavedStreak(activeStreak, model, weightRows, calorieRows, activeRows) {
  const streak = normalizeStreak(activeStreak);
  const endDate = todayISO();
  const weightInStreak = weightRows.filter((r) => r.date >= streak.startDate && r.date <= endDate);
  const calorieDates = new Set(calorieRows.filter((r) => r.date >= streak.startDate && r.date <= endDate).map((r) => r.date));
  const activeDates = new Set(activeRows.filter((r) => r.date >= streak.startDate && r.date <= endDate).map((r) => r.date));
  return {
    id: `${Date.now()}`,
    savedAt: new Date().toISOString(),
    startDate: streak.startDate,
    endDate,
    startWeightKg: streak.startWeightKg,
    plannedEndWeightKg: streak.endWeightKg,
    latestWeightKg: model.latestWeight == null ? null : r2(model.latestWeight),
    daysLogged: new Set([...calorieDates, ...activeDates, ...weightInStreak.map((r) => r.date)]).size,
    horizonWeeks: streak.horizonWeeks,
    caloriePlan: streak.caloriePlan,
  };
}

function readStoredJSON(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function compute(weightRows, calorieRows, activeRows, caloriePlan, activeStreak) {
  const normalizedStreak = normalizeStreak(activeStreak);
  const planStart = normalizedStreak.startDate;
  const horizonWeeks = normalizedStreak.horizonWeeks;
  const ws = [...weightRows].filter((r) => r.date >= planStart).sort((a, b) => a.date.localeCompare(b.date));
  const cs = [...calorieRows].filter((r) => r.date >= planStart).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const as = [...activeRows].filter((r) => r.date >= planStart).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const week = getWeek(planStart, todayISO());
  const baseTarget = caloriePlan[Math.min(week, horizonWeeks)] ?? DEFAULT_CALORIE_PLAN[Math.min(week, 16)] ?? 3000;

  const vals = ws.map((x) => Number(x.weight_kg));
  const latestWeight = vals.length ? vals[vals.length - 1] : null;
  const avg7 = vals.length >= 7 ? avg(vals.slice(-7)) : null;
  const prev7 = vals.length >= 14 ? avg(vals.slice(-14, -7)) : null;
  const weeklyChange = avg7 != null && prev7 != null ? avg7 - prev7 : null;

  const dmap = {};
  const pmap = {};
  cs.forEach((r) => {
    dmap[r.date] = (dmap[r.date] || 0) + Number(r.calories || 0);
    pmap[r.date] = (pmap[r.date] || 0) + Number(r.protein_g || 0);
  });
  const daily = Object.keys(dmap).map((date) => ({ date, daily_calories: dmap[date], daily_protein: pmap[date] || 0 })).sort((a, b) => a.date.localeCompare(b.date));
  const amap = {};
  as.forEach((r) => { amap[r.date] = (amap[r.date] || 0) + Number(r.calories || 0); });
  const todayCalories = dmap[todayISO()] ?? 0;
  const todayProtein = pmap[todayISO()] ?? 0;
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
  const calorieChart = daily.map((d) => {
    const chartWeek = Math.min(getWeek(planStart, d.date), horizonWeeks);
    return { ...d, target_calories: (caloriePlan[chartWeek] ?? DEFAULT_CALORIE_PLAN[Math.min(chartWeek, 16)] ?? 3000) + (amap[d.date] ?? 0) };
  });
  const weeklyCalsByWeek = {};
  const today = todayISO();
  daily.forEach((d) => {
    // Exclude today from weekly averages because the day may still be in progress.
    if (d.date === today) return;
    const w = getWeek(planStart, d.date);
    if (!weeklyCalsByWeek[w]) weeklyCalsByWeek[w] = [];
    weeklyCalsByWeek[w].push(d.daily_calories);
  });

  const weeklyTargetChart = Array.from({ length: horizonWeeks }, (_, i) => {
    const weekNum = i + 1;
    const d = new Date(planStart);
    d.setDate(d.getDate() + i * 7);
    const weekVals = weeklyCalsByWeek[weekNum] || [];
    return {
      week: weekNum,
      date: d.toISOString().slice(0, 10),
      target_calories: caloriePlan[weekNum] ?? DEFAULT_CALORIE_PLAN[weekNum],
      avg_week_calories: weekVals.length ? avg(weekVals) : null,
    };
  });

  const targetEndDate = addDays(planStart, horizonWeeks * 7 - 1);
  const streakDay = Math.max(1, Math.floor((new Date(todayISO()) - new Date(planStart)) / 86400000) + 1);

  return { currentWeek: week, todayTarget, todayCalories, todayProtein, todayActiveCalories, caloriesLeft, latestWeight, avg7, prev7, weeklyChange, avgCal, diff, guidance, weightChart, calorieChart, weeklyTargetChart, targetEndDate, streakDay };
}

function getWeek(planStart, dateStr) {
  const days = Math.floor((new Date(dateStr) - new Date(planStart)) / 86400000);
  return Math.max(1, Math.floor(days / 7) + 1);
}

const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

function addDays(dateStr, days) {
  const d = new Date(dateStr || todayISO());
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function filterLast7Days(data, enabled) {
  if (!enabled) return data;
  const start = new Date();
  start.setDate(start.getDate() - 6);
  const startISO = start.toISOString().slice(0, 10);
  return data.filter((d) => d.date >= startISO);
}

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
