from __future__ import annotations

from datetime import date, datetime, time, timedelta

import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from supabase import Client, create_client


st.set_page_config(page_title="16-Week Weight Gain Tracker", layout="wide")

PLAN_LENGTH_WEEKS = 16
BASELINE_WEIGHT_KG = 73.0
MEAL_TAGS = ["breakfast", "lunch", "snack", "dinner", "other"]
LOCKED_CHART_CONFIG = {
    "scrollZoom": False,
    "displayModeBar": False,
    "doubleClick": False,
}

CALORIE_PLAN = {
    1: 2560,
    2: 2600,
    3: 2640,
    4: 2690,
    5: 2730,
    6: 2770,
    7: 2820,
    8: 2860,
    9: 2900,
    10: 2940,
    11: 2990,
    12: 3030,
    13: 3070,
    14: 3120,
    15: 3160,
    16: 3200,
}


def apply_responsive_styles() -> None:
    st.markdown(
        """
        <style>
        @media (max-width: 768px) {
            .block-container {
                padding-top: 1rem;
                padding-left: 0.75rem;
                padding-right: 0.75rem;
            }

            h1 {
                font-size: 1.6rem;
                line-height: 1.25;
            }

            [data-testid="stMetricLabel"] {
                font-size: 0.85rem;
            }

            [data-testid="stMetricValue"] {
                font-size: 1.25rem;
            }

            [data-testid="column"] {
                min-width: 100% !important;
                flex: 1 1 100% !important;
            }

            [data-testid="stTabs"] button {
                padding: 0.5rem 0.55rem;
                font-size: 0.85rem;
            }
        }
        </style>
        """,
        unsafe_allow_html=True,
    )


@st.cache_data(show_spinner=False)
def get_default_weight_template() -> pd.DataFrame:
    return pd.DataFrame(columns=["date", "weight_kg", "notes"])


@st.cache_data(show_spinner=False)
def get_default_calorie_template() -> pd.DataFrame:
    return pd.DataFrame(columns=["date", "time", "meal_tag", "calories", "notes"])


def get_supabase_client() -> Client:
    try:
        url = st.secrets["SUPABASE_URL"]
        key = st.secrets["SUPABASE_KEY"]
    except Exception as exc:
        raise RuntimeError(
            "Missing SUPABASE_URL or SUPABASE_KEY in Streamlit secrets."
        ) from exc

    return create_client(url, key)


def load_weight_data(client: Client) -> pd.DataFrame:
    response = (
        client.table("bodyweight_log")
        .select("date, weight_kg, notes")
        .order("date", desc=False)
        .execute()
    )

    if not response.data:
        return get_default_weight_template().copy()

    df = pd.DataFrame(response.data)
    for col in ["date", "weight_kg", "notes"]:
        if col not in df.columns:
            df[col] = pd.NA

    df = df[["date", "weight_kg", "notes"]].copy()
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df["weight_kg"] = pd.to_numeric(df["weight_kg"], errors="coerce")
    df["notes"] = df["notes"].fillna("").astype(str)

    return df.dropna(subset=["date", "weight_kg"]).sort_values("date").reset_index(drop=True)


def load_calorie_data(client: Client) -> pd.DataFrame:
    response = (
        client.table("calorie_log")
        .select("date, time, meal_tag, calories, notes")
        .order("date", desc=False)
        .order("time", desc=False)
        .execute()
    )

    if not response.data:
        return get_default_calorie_template().copy()

    df = pd.DataFrame(response.data)
    for col in ["date", "time", "meal_tag", "calories", "notes"]:
        if col not in df.columns:
            df[col] = pd.NA

    df = df[["date", "time", "meal_tag", "calories", "notes"]].copy()
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df["time"] = df["time"].fillna("12:00").astype(str)
    df["meal_tag"] = df["meal_tag"].fillna("other").astype(str).str.lower()
    df["meal_tag"] = df["meal_tag"].apply(lambda x: x if x in MEAL_TAGS else "other")
    df["calories"] = pd.to_numeric(df["calories"], errors="coerce")
    df["notes"] = df["notes"].fillna("").astype(str)

    return df.dropna(subset=["date", "calories"]).sort_values(["date", "time"]).reset_index(drop=True)


def save_weight_entry(client: Client, entry_date: date, weight_kg: float, notes: str) -> None:
    client.table("bodyweight_log").insert(
        {
            "date": entry_date.isoformat(),
            "weight_kg": float(weight_kg),
            "notes": notes.strip(),
        }
    ).execute()


def save_calorie_entry(
    client: Client,
    entry_date: date,
    entry_time: time,
    meal_tag: str,
    calories: int,
    notes: str,
) -> None:
    client.table("calorie_log").insert(
        {
            "date": entry_date.isoformat(),
            "time": entry_time.strftime("%H:%M"),
            "meal_tag": meal_tag.lower(),
            "calories": int(calories),
            "notes": notes.strip(),
        }
    ).execute()


def compute_plan_start(weight_df: pd.DataFrame, cal_df: pd.DataFrame) -> date:
    starts: list[date] = []
    if not weight_df.empty:
        starts.append(weight_df["date"].min().date())
    if not cal_df.empty:
        starts.append(cal_df["date"].min().date())
    return min(starts) if starts else date.today()


def get_current_week(plan_start: date) -> int:
    days_since_start = (date.today() - plan_start).days
    week = (days_since_start // 7) + 1
    return max(1, min(PLAN_LENGTH_WEEKS, week))


def get_target_for_day(check_date: date, plan_start: date) -> int:
    days_since_start = (check_date - plan_start).days
    week = (days_since_start // 7) + 1
    week = max(1, min(PLAN_LENGTH_WEEKS, week))
    return CALORIE_PLAN[week]


def get_daily_calories(cal_df: pd.DataFrame) -> pd.DataFrame:
    if cal_df.empty:
        return pd.DataFrame(
            {
                "date": pd.Series(dtype="datetime64[ns]"),
                "daily_calories": pd.Series(dtype="float64"),
            }
        )

    daily_df = cal_df.dropna(subset=["date", "calories"]).copy()
    if daily_df.empty:
        return pd.DataFrame(
            {
                "date": pd.Series(dtype="datetime64[ns]"),
                "daily_calories": pd.Series(dtype="float64"),
            }
        )

    daily_df["date"] = daily_df["date"].dt.normalize()
    grouped = (
        daily_df.groupby("date", as_index=False)
        .agg(daily_calories=("calories", "sum"))
    )
    return grouped.sort_values("date").reset_index(drop=True)


def compute_metrics(weight_df: pd.DataFrame, cal_df: pd.DataFrame) -> dict:
    plan_start = compute_plan_start(weight_df, cal_df)
    current_week = get_current_week(plan_start)
    today_target = CALORIE_PLAN[current_week]

    latest_weight = (
        float(weight_df.iloc[-1]["weight_kg"]) if not weight_df.empty else BASELINE_WEIGHT_KG
    )
    avg_7 = weight_df["weight_kg"].tail(7).mean() if len(weight_df) >= 7 else None
    prev_avg_7 = weight_df["weight_kg"].tail(14).head(7).mean() if len(weight_df) >= 14 else None

    weekly_change = None
    if avg_7 is not None and prev_avg_7 is not None:
        weekly_change = float(avg_7 - prev_avg_7)

    daily_cal = get_daily_calories(cal_df)
    week_start = date.today() - timedelta(days=date.today().weekday())
    week_end = week_start + timedelta(days=6)

    if daily_cal.empty:
        this_week_daily_cal = daily_cal
    else:
        this_week_mask = (daily_cal["date"].dt.date >= week_start) & (daily_cal["date"].dt.date <= week_end)
        this_week_daily_cal = daily_cal[this_week_mask]

    avg_cal_this_week = (
        float(this_week_daily_cal["daily_calories"].mean()) if not this_week_daily_cal.empty else None
    )
    cal_diff = float(avg_cal_this_week - today_target) if avg_cal_this_week is not None else None

    guidance = build_guidance(weight_df, weekly_change)

    return {
        "current_week": current_week,
        "today_target": today_target,
        "latest_weight": latest_weight,
        "avg_7": avg_7,
        "prev_avg_7": prev_avg_7,
        "weekly_change": weekly_change,
        "avg_cal_this_week": avg_cal_this_week,
        "cal_diff": cal_diff,
        "guidance": guidance,
        "plan_start": plan_start,
        "daily_cal": daily_cal,
    }


def build_guidance(weight_df: pd.DataFrame, weekly_change: float | None) -> str:
    if len(weight_df) < 14 or weekly_change is None:
        return "Not enough bodyweight entries yet for a reliable adjustment (need at least 14 days)."

    if weekly_change < 0.25:
        return "Weekly average gain is under 0.25 kg. Consider increasing calories by 150-200 kcal/day."
    if 0.25 <= weekly_change <= 0.5:
        return "Weekly average gain is 0.25-0.5 kg. Progress is ideal."
    if weekly_change > 0.7:
        return "Weekly average gain is above 0.7 kg. Consider reducing calories by 150 kcal/day."

    return "Progress is acceptable. Continue monitoring and keep intake consistent."


def display_metric(value: float | int | None, suffix: str = "") -> str:
    if value is None:
        return "-"
    if isinstance(value, int):
        return f"{value}{suffix}"
    return f"{value:.2f}{suffix}"


def prepare_weight_chart_df(weight_df: pd.DataFrame) -> pd.DataFrame:
    if weight_df.empty:
        return weight_df.copy()

    chart_df = weight_df.copy()
    chart_df["weight_7d_avg"] = chart_df["weight_kg"].rolling(window=7).mean()
    return chart_df


def prepare_calorie_chart_df(daily_cal_df: pd.DataFrame, plan_start: date) -> pd.DataFrame:
    if daily_cal_df.empty:
        return daily_cal_df.copy()

    chart_df = daily_cal_df.copy()
    chart_df["target_calories"] = chart_df["date"].dt.date.apply(
        lambda d: get_target_for_day(d, plan_start)
    )
    return chart_df


def get_chart_y_range(series_list: list[pd.Series], min_padding: float) -> list[float] | None:
    values = pd.concat(series_list).dropna()
    if values.empty:
        return None

    y_min = float(values.min())
    y_max = float(values.max())
    spread = y_max - y_min
    padding = max(spread * 0.12, min_padding)
    return [y_min - padding, y_max + padding]


def render_locked_line_chart(
    chart_df: pd.DataFrame,
    title: str,
    series: dict[str, str],
    y_title: str,
    min_y_padding: float,
) -> None:
    fig = go.Figure()
    for column, label in series.items():
        clean_df = chart_df.dropna(subset=["date", column])
        if clean_df.empty:
            continue

        fig.add_trace(
            go.Scatter(
                x=clean_df["date"],
                y=clean_df[column],
                mode="lines+markers",
                name=label,
                hovertemplate="%{x|%d %b %Y}<br>%{y:.1f}<extra></extra>",
            )
        )

    if not fig.data:
        st.write(f"Not enough data yet for {title.lower()}.")
        return

    y_range = get_chart_y_range(
        [chart_df[column] for column in series if column in chart_df.columns],
        min_y_padding,
    )
    fig.update_layout(
        height=340,
        margin=dict(l=8, r=8, t=12, b=8),
        hovermode="x unified",
        dragmode=False,
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="left", x=0),
        xaxis=dict(fixedrange=True, title=None),
        yaxis=dict(fixedrange=True, title=y_title, rangemode="normal", range=y_range),
    )
    st.plotly_chart(fig, use_container_width=True, config=LOCKED_CHART_CONFIG)


def main() -> None:
    apply_responsive_styles()

    st.title("16-Week Weight Gain Tracker")
    st.caption("Track bodyweight separately from meal calorie entries throughout the day.")

    try:
        client = get_supabase_client()
        weight_df = load_weight_data(client)
        cal_df = load_calorie_data(client)
    except Exception as exc:
        st.error(f"Supabase connection/setup error: {exc}")
        st.stop()

    metrics = compute_metrics(weight_df, cal_df)
    weight_chart_df = prepare_weight_chart_df(weight_df)
    cal_chart_df = prepare_calorie_chart_df(metrics["daily_cal"], metrics["plan_start"])

    tab_weight_entry, tab_calorie_entry, tab_dashboard, tab_charts, tab_data = st.tabs(
        ["Bodyweight Entry", "Calorie Entry", "Dashboard", "Charts", "Data"]
    )

    with tab_weight_entry:
        st.subheader("Log Bodyweight")
        with st.form("bodyweight_entry_form", clear_on_submit=True):
            entry_date = st.date_input("Date", value=date.today(), key="weight_date")
            weight_kg = st.number_input(
                "Body weight (kg)", min_value=30.0, max_value=250.0, value=73.0, step=0.1, format="%.1f"
            )
            notes = st.text_area("Notes (optional)", placeholder="Hydration, training load, sleep, etc.")

            if st.form_submit_button("Save Bodyweight"):
                save_weight_entry(client, entry_date, weight_kg, notes)
                st.success("Bodyweight entry saved.")
                st.cache_data.clear()
                st.rerun()

    with tab_calorie_entry:
        st.subheader("Log Calories")
        with st.form("calorie_entry_form", clear_on_submit=True):
            entry_date = st.date_input("Date", value=date.today(), key="calorie_date")
            entry_time = st.time_input("Time", value=datetime.now().time().replace(second=0, microsecond=0))
            meal_tag = st.selectbox("Meal tag", options=MEAL_TAGS, index=0)
            calories = st.number_input("Calories", min_value=1, max_value=5000, value=400, step=10)
            notes = st.text_area("Notes (optional)", placeholder="Food items, portion estimate, etc.")

            if st.form_submit_button("Add Calorie Entry"):
                save_calorie_entry(client, entry_date, entry_time, meal_tag, int(calories), notes)
                st.success("Calorie entry saved.")
                st.cache_data.clear()
                st.rerun()

    with tab_dashboard:
        st.subheader("Dashboard")

        col1, col2, col3, col4 = st.columns(4)
        col1.metric("Current Week", f"Week {metrics['current_week']}")
        col2.metric("Today's Target", f"{metrics['today_target']} kcal")
        col3.metric("Latest Weight", display_metric(metrics["latest_weight"], " kg"))
        col4.metric("7-Day Avg Weight", display_metric(metrics["avg_7"], " kg"))

        col5, col6, col7, col8 = st.columns(4)
        col5.metric("Prev 7-Day Avg Weight", display_metric(metrics["prev_avg_7"], " kg"))
        col6.metric("Weekly Weight Change", display_metric(metrics["weekly_change"], " kg"))
        col7.metric("Avg Daily Calories This Week", display_metric(metrics["avg_cal_this_week"], " kcal"))
        col8.metric("Avg Daily Calories vs Target", display_metric(metrics["cal_diff"], " kcal"))

        st.markdown("### Progress Guidance")
        st.info(metrics["guidance"])

    with tab_charts:
        st.subheader("Progress Charts")

        if weight_chart_df.empty:
            st.write("No bodyweight data yet. Add entries in the Bodyweight Entry tab.")
        else:
            st.markdown("#### Daily Bodyweight")
            render_locked_line_chart(
                weight_chart_df,
                "Daily Bodyweight",
                {"weight_kg": "Daily bodyweight"},
                "kg",
                0.4,
            )

            st.markdown("#### 7-Day Rolling Average Bodyweight")
            render_locked_line_chart(
                weight_chart_df,
                "7-Day Rolling Average Bodyweight",
                {"weight_7d_avg": "7-day average"},
                "kg",
                0.3,
            )

        if cal_chart_df.empty:
            st.write("No calorie data yet. Add entries in the Calorie Entry tab.")
        else:
            st.markdown("#### Daily Calories (Summed) vs Target")
            render_locked_line_chart(
                cal_chart_df,
                "Daily Calories",
                {
                    "daily_calories": "Daily calories",
                    "target_calories": "Target calories",
                },
                "kcal",
                150,
            )

    with tab_data:
        st.subheader("Data")

        st.markdown("#### Bodyweight Log")
        if weight_df.empty:
            st.write("No bodyweight entries logged yet.")
        else:
            weight_display = weight_df.copy()
            weight_display["date"] = weight_display["date"].dt.date
            st.dataframe(weight_display, use_container_width=True)

        st.markdown("#### Calorie Log")
        if cal_df.empty:
            st.write("No calorie entries logged yet.")
        else:
            cal_display = cal_df.copy()
            cal_display["date"] = cal_display["date"].dt.date
            st.dataframe(cal_display, use_container_width=True)

        st.markdown("#### Downloads")
        st.download_button(
            label="Download Bodyweight CSV",
            data=weight_df.to_csv(index=False).encode("utf-8"),
            file_name="bodyweight_log.csv",
            mime="text/csv",
        )
        st.download_button(
            label="Download Calorie CSV",
            data=cal_df.to_csv(index=False).encode("utf-8"),
            file_name="calorie_log.csv",
            mime="text/csv",
        )


if __name__ == "__main__":
    main()
