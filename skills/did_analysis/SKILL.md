---
name: did_analysis
description: Performs Multi-period Difference-in-Differences (DiD) analysis on a CSV dataset using a Two-Way Fixed Effects (TWFE) linear model.
---

# DID Analysis

This skill analyzes a CSV file to perform a Multi-period Difference-in-Differences analysis. It includes preprocessing, regression analysis, and visualization generation.

## Usage

You can use the python script `analyze_did.py` to perform the analysis.

### Arguments

- `file` (required): Path to the input CSV file.
- `--id_col`: Name of the unit ID column (default: "id").
- `--t_col`: Name of the time period column (default: "t").
- `--y_col`: Name of the outcome column (default: "Y").
- `--treated_col`: Name of the treated indicator column (0/1) (default: "treated").
- `--policy_time` (required): Time when the policy starts (integer or string matching time column).
- `--x_cols`: List of control variable columns (optional).

### Example

```bash
python3 skills/did_analysis/analyze_did.py data.csv --id_col state --t_col year --y_col employment --treated_col is_treated --policy_time 2020
```

### Output

The script outputs a JSON object to stdout.
Artifacts are saved to: `/Users/veso/Documents/verso/DIDanalyze/`

- `regression_results`: Key statistics (coefficient, standard error, p-value, R-squared).
- `output_files`: Absolute paths to the generated files:
  - `trends_plot`: PNG image of the parallel trends plot.
  - `event_study_plot`: PNG image of the event study plot (if applicable).
  - `table_csv`: CSV file containing the three-line table of results.
  - `table_png`: PNG image of the three-line table.

### Dependencies

Make sure to install the dependencies listed in `requirements.txt` before running the script:

```bash
pip install -r skills/did_analysis/requirements.txt
```
