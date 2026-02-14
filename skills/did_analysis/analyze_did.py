
import argparse
import json
import os
import sys
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import statsmodels.formula.api as smf

# -------------------------
# 1) Preprocessing function
# -------------------------
from typing import List, Optional

def preprocess_for_did(
    df: pd.DataFrame,
    *,
    id_col: str,
    t_col: str,
    y_col: str,
    treated_col: str,
    policy_time,
    x_cols: Optional[List[str]] = None,
    missing_strategy: str = "drop",      # "drop" | "raise" | "impute_simple"
    enforce_binary_treated: bool = True,
) -> pd.DataFrame:
    """
    Preprocess a long panel for DID.
    """
    df = df.copy()

    # ---- required columns
    required = [id_col, t_col, y_col, treated_col]
    for c in required:
        if c not in df.columns:
            raise ValueError(f"Missing required column: {c}")

    x_cols = x_cols or []
    for c in x_cols:
        if c not in df.columns:
            raise ValueError(f"Missing X column listed in x_cols: {c}")

    # ---- best-effort type normalization
    df[id_col] = df[id_col].astype(str)

    # Try to coerce time to numeric; if fails, keep original but still sortable
    t_num = pd.to_numeric(df[t_col], errors="coerce")
    if t_num.notna().mean() > 0.9:  # mostly numeric -> use numeric
        df[t_col] = t_num.astype(int)
        if isinstance(policy_time, str):
            try:
                policy_time = int(policy_time)
            except ValueError:
                pass 

    # ---- treated to 0/1
    if enforce_binary_treated:
        df[treated_col] = pd.to_numeric(df[treated_col], errors="coerce")
        if df[treated_col].isna().any():
            raise ValueError(f"{treated_col} has non-numeric values; clean it to 0/1 first.")
        uniq = set(df[treated_col].dropna().unique().tolist())
        if not uniq.issubset({0, 1}):
            raise ValueError(f"{treated_col} must be binary 0/1. Found values: {sorted(list(uniq))}")
        df[treated_col] = df[treated_col].astype(int)

    # ---- create post/D/rel_t if missing
    if "post" not in df.columns:
        if pd.api.types.is_numeric_dtype(df[t_col]):
             df["post"] = (df[t_col] >= policy_time).astype(int)
        else:
             # String comparison for dates if not numeric
             df["post"] = (df[t_col] >= str(policy_time)).astype(int)

    if "D" not in df.columns:
        df["D"] = df[treated_col] * df["post"]

    if "rel_t" not in df.columns and pd.api.types.is_numeric_dtype(df[t_col]):
        df["rel_t"] = df[t_col] - policy_time

    # ---- duplicates check (id,t should be unique)
    dup_mask = df.duplicated(subset=[id_col, t_col], keep=False)
    if dup_mask.any():
        df = df.loc[~dup_mask | ~df.duplicated(subset=[id_col, t_col], keep="first")].copy()

    # ---- missing values handling
    check_cols = required + x_cols + ["post", "D"]
    if "rel_t" in df.columns:
        check_cols.append("rel_t")
        
    na_counts = df[check_cols].isna().sum()

    if missing_strategy == "raise":
        if na_counts.sum() > 0:
            raise ValueError(f"Missing values found:\n{na_counts[na_counts>0].to_string()}")

    elif missing_strategy == "drop":
        df = df.dropna(subset=check_cols).copy()

    elif missing_strategy == "impute_simple":
        core = [id_col, t_col, y_col, treated_col]
        df = df.dropna(subset=core).copy()

        for c in x_cols:
            if df[c].isna().any():
                if pd.api.types.is_numeric_dtype(df[c]):
                    df[c] = df[c].fillna(df[c].median())
                else:
                    df[c] = df[c].fillna(df[c].mode(dropna=True).iloc[0])
        
        # Recompute logic
        if pd.api.types.is_numeric_dtype(df[t_col]):
             df["post"] = (df[t_col] >= policy_time).astype(int)
        else:
             df["post"] = (df[t_col] >= str(policy_time)).astype(int)
             
        df["D"] = df[treated_col] * df["post"]
        if pd.api.types.is_numeric_dtype(df[t_col]):
            df["rel_t"] = df[t_col] - policy_time

    # ---- sort by (id,t)
    df = df.sort_values([id_col, t_col]).reset_index(drop=True)

    return df


# -------------------------
# 2) Main TWFE DID regression
# -------------------------
def fit_twfe_did(df, *, y_col="Y", d_col="D", x_cols=None, id_col="id", t_col="t"):
    x_cols = x_cols or []
    x_part = " + ".join(x_cols) if x_cols else ""
    formula = f"{y_col} ~ {d_col}"
    if x_part:
        formula += f" + {x_part}"
    formula += f" + C({id_col}) + C({t_col})"

    return smf.ols(formula, data=df).fit(
        cov_type="cluster", cov_kwds={"groups": df[id_col]}
    )


# -------------------------
# 3) Plots
# -------------------------
def plot_trends(df, *, policy_time, y_col="Y", treated_col="treated", t_col="t", out_png="did_trends.png"):
    grp = df.groupby([treated_col, t_col])[y_col].mean().reset_index()
    piv = grp.pivot(index=t_col, columns=treated_col, values=y_col)

    plt.figure(figsize=(7, 4.2))
    if 0 in piv.columns:
        plt.plot(piv.index, piv.get(0), marker="o", label="Control (treated=0)")
    if 1 in piv.columns:
        plt.plot(piv.index, piv.get(1), marker="o", label="Treated (treated=1)")
    
    # Handle policy time line for numeric vs string
    if pd.api.types.is_numeric_dtype(df[t_col]):
         plt.axvline(policy_time - 0.5, linestyle="--", color="gray")
    else:
         # Try to find index of policy_time
         unique_ts = sorted(df[t_col].unique())
         try:
             idx = unique_ts.index(str(policy_time))
             plt.axvline(idx - 0.5, linestyle="--", color="gray")
         except ValueError:
             pass

    plt.title("Average outcome over time (Treated vs Control)")
    plt.xlabel("Time period")
    plt.ylabel(f"Mean {y_col}")
    plt.legend()
    plt.tight_layout()
    plt.savefig(out_png, dpi=200)
    plt.close()


def fit_and_plot_event_study(
    df,
    *,
    policy_time,
    y_col="Y",
    treated_col="treated",
    t_col="t",
    x_cols=None,
    id_col="id",
    rel_min=-5,
    rel_max=5,
    ref_rel=-1,
    out_png="event_study.png",
):
    df = df.copy()
    x_cols = x_cols or []

    if "rel_t" not in df.columns:
        # Cannot run event study if time is not numeric to compute relative time easily
        # For simplicity, we skip if rel_t calculation failed (e.g. string dates)
        sys.stderr.write("Skipping event study: time column not numeric.\n")
        return None, None

    def evt_name(k: int) -> str:
        return f"lead{abs(k)}" if k < 0 else f"lag{k}"

    evt_vars = []
    for k in range(rel_min, rel_max + 1):
        if k == ref_rel:
            continue
        v = evt_name(k)
        df[v] = ((df[treated_col] == 1) & (df["rel_t"] == k)).astype(int)
        evt_vars.append(v)
    
    # Check if we have enough variations
    valid_evt_vars = []
    for v in evt_vars:
        if df[v].sum() > 0:
            valid_evt_vars.append(v)
            
    if not valid_evt_vars:
         sys.stderr.write("Skipping event study: no valid event periods found in range.\n")
         return None, None

    rhs = " + ".join(valid_evt_vars)
    if x_cols:
        rhs += " + " + " + ".join(x_cols)
    rhs += f" + C({id_col}) + C({t_col})"

    try:
        res = smf.ols(f"{y_col} ~ {rhs}", data=df).fit(
            cov_type="cluster", cov_kwds={"groups": df[id_col]}
        )
    except Exception as e:
        sys.stderr.write(f"Event study regression failed: {e}\n")
        return None, None

    rows = []
    for k in range(rel_min, rel_max + 1):
        if k == ref_rel:
            continue
        term = evt_name(k)
        if term in res.params:
            rows.append([k, res.params[term], res.bse[term]])
    
    if not rows:
        return None, None

    es = pd.DataFrame(rows, columns=["rel_time", "coef", "se"]).sort_values("rel_time")

    plt.figure(figsize=(7, 4.2))
    plt.errorbar(es["rel_time"], es["coef"], yerr=1.96 * es["se"], fmt="o", capsize=3)
    plt.axhline(0, linestyle="--", color="gray")
    plt.axvline(0, linestyle="--", color="gray")
    plt.title(f"Event-study (ref = rel_time = {ref_rel})")
    plt.xlabel("Relative time (t - policy_time)")
    plt.ylabel(f"Effect on {y_col} (vs ref)")
    plt.tight_layout()
    plt.savefig(out_png, dpi=200)
    plt.close()

    return res, es


# -------------------------
# 4) Three-line table output
# -------------------------
def make_three_line_table(res, *, main_term="D", out_csv="three_line_table.csv"):
    if main_term not in res.params:
        return None
        
    tbl = pd.DataFrame({
        "Term": [main_term],
        "Coef": [res.params[main_term]],
        "Std.Err.": [res.bse[main_term]],
        "P-value": [res.pvalues[main_term]],
    })

    tbl_fmt = pd.DataFrame({
        "Term": tbl["Term"],
        "Coef": tbl["Coef"].map(lambda x: f"{x:.3f}"),
        "Std.Err.": tbl["Std.Err."].map(lambda x: f"({x:.3f})"),
        "P-value": tbl["P-value"].map(lambda x: f"{x:.4f}"),
    })
    tbl_fmt.to_csv(out_csv, index=False)
    return tbl_fmt


def save_three_line_table_png(df, out_png):
    """
    Render a DataFrame as a matplotlib figure in "Three-Line Table" style.
    """
    if df is None or df.empty:
        return

    # Create figure
    fig, ax = plt.subplots(figsize=(6, 2 + len(df) * 0.5))
    ax.axis('off')

    # Table data as list of lists
    cell_text = []
    # Headers
    headers = df.columns.tolist()
    
    # Rows
    for _, row in df.iterrows():
        cell_text.append(row.tolist())

    # Create table
    # transform bbox to be consistent
    table = ax.table(cellText=cell_text, colLabels=headers, loc='center', cellLoc='center', bbox=[0, 0, 1, 1])
    
    # Style styling
    table.auto_set_font_size(False)
    table.set_fontsize(12)
    
    # Remove all cell borders first
    for key, cell in table.get_celld().items():
        cell.set_linewidth(0)

    # Add three lines (Top of Header, Bottom of Header, Bottom of Table)
    # Get table renderer to find coordinates, but simplified:
    # Matplotlib table doesn't support partial borders easily. 
    # We will draw lines manually relative to table rows.
    
    # We can use the 'edges' property if we iterate, but it's simpler to just
    # draw lines on the axes. The table occupies [0, 0, 1, 1] in axes coordinates.
    
    # Header height is roughly 1/(rows+1)
    n_rows = len(df)
    n_total = n_rows + 1 # +1 for header
    row_height = 1.0 / n_total
    
    # Line 1: Top of header (y=1)
    ax.plot([0, 1], [1, 1], color='black', linewidth=1.5, transform=ax.transAxes)
    
    # Line 2: Bottom of header (y = 1 - row_height)
    header_bottom = 1 - row_height
    ax.plot([0, 1], [header_bottom, header_bottom], color='black', linewidth=1.0, transform=ax.transAxes)
    
    # Line 3: Bottom of table (y=0)
    ax.plot([0, 1], [0, 0], color='black', linewidth=1.5, transform=ax.transAxes)

    plt.tight_layout()
    plt.savefig(out_png, dpi=300, bbox_inches='tight')
    plt.close()


# -------------------------
# 5) Main Entry Point
# -------------------------
def main():
    parser = argparse.ArgumentParser(description="Multi-period DID Analysis")
    parser.add_argument("file", help="Path to CSV data file")
    parser.add_argument("--id_col", default="id", help="Unit ID column")
    parser.add_argument("--t_col", default="t", help="Time period column")
    parser.add_argument("--y_col", default="Y", help="Outcome column")
    parser.add_argument("--treated_col", default="treated", help="Treated indicator column (0/1)")
    parser.add_argument("--policy_time", required=True, help="Policy start time")
    parser.add_argument("--x_cols", nargs="*", help="Control variables")
    
    args = parser.parse_args()

    # Fixed output directory as requested
    OUTPUT_DIR = "/Users/veso/Documents/verso/DIDanalyze"
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    try:
        df = pd.read_csv(args.file)
    except Exception as e:
        print(json.dumps({"error": f"Failed to read CSV: {str(e)}"}))
        return

    # Try to parse policy_time as int if it looks like one, else keep as string
    policy_time = args.policy_time
    try:
        policy_time = int(policy_time)
    except ValueError:
        pass

    try:
        df = preprocess_for_did(
            df,
            id_col=args.id_col,
            t_col=args.t_col,
            y_col=args.y_col,
            treated_col=args.treated_col,
            policy_time=policy_time,
            x_cols=args.x_cols,
            missing_strategy="drop", 
        )
    except Exception as e:
        print(json.dumps({"error": f"Preprocessing failed: {str(e)}"}))
        return

    # TWFE DID
    try:
        twfe_res = fit_twfe_did(
            df, 
            y_col=args.y_col, 
            d_col="D", 
            x_cols=args.x_cols, 
            id_col=args.id_col, 
            t_col=args.t_col
        )
    except Exception as e:
        print(json.dumps({"error": f"Regression failed: {str(e)}"}))
        return

    # Visuals
    trends_path = os.path.join(OUTPUT_DIR, "did_trends.png")
    plot_trends(
        df, 
        policy_time=policy_time, 
        y_col=args.y_col, 
        treated_col=args.treated_col, 
        t_col=args.t_col, 
        out_png=trends_path
    )
    
    event_study_path = os.path.join(OUTPUT_DIR, "event_study.png")
    es_res, es_tbl = fit_and_plot_event_study(
        df,
        policy_time=policy_time,
        y_col=args.y_col, 
        treated_col=args.treated_col, 
        t_col=args.t_col, 
        x_cols=args.x_cols, 
        id_col=args.id_col, 
        out_png=event_study_path
    )

    # Three-line table
    table_path = os.path.join(OUTPUT_DIR, "three_line_table.csv")
    table_png_path = os.path.join(OUTPUT_DIR, "three_line_table.png")
    three_line = make_three_line_table(twfe_res, main_term="D", out_csv=table_path)
    if three_line is not None:
        save_three_line_table_png(three_line, table_png_path)
    
    # Construct JSON response
    result = {
        "status": "success",
        "output_files": {
            "trends_plot": os.path.abspath(trends_path),
            "event_study_plot": os.path.abspath(event_study_path) if es_res else None,
            "table_csv": os.path.abspath(table_path),
            "table_png": os.path.abspath(table_png_path) if three_line is not None else None
        },
        "regression_results": {
            "term": "D",
            "coef": twfe_res.params.get("D"),
            "std_err": twfe_res.bse.get("D"),
            "p_value": twfe_res.pvalues.get("D"),
            "n_obs": int(twfe_res.nobs),
            "r_squared": twfe_res.rsquared
        }
    }
    
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()
