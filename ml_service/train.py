from pathlib import Path
import pandas as pd
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans
import joblib
import numpy as np
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
MODELS = ROOT / "models"; MODELS.mkdir(exist_ok=True)
OUTPUTS = ROOT / "outputs"; OUTPUTS.mkdir(exist_ok=True)


def find_optimal_k(X_scaled, k_min=2, k_max=10):
    """Automatically determine optimal K using the Elbow Method."""
    sse = []
    K_values = range(k_min, k_max + 1)
    for k in K_values:
        km = KMeans(n_clusters=k, random_state=42, n_init=20, max_iter=500)
        km.fit(X_scaled)
        sse.append(km.inertia_)

    # Compute elbow automatically
    diffs = np.diff(sse)
    diff_ratios = np.abs(diffs[1:] / diffs[:-1])
    elbow_k = k_min + np.argmin(diff_ratios) + 1

    # Save elbow plot
    plt.figure(figsize=(6, 4))
    plt.plot(K_values, sse, marker='o')
    plt.title("Elbow Method for Optimal K")
    plt.xlabel("Number of Clusters (K)")
    plt.ylabel("SSE (Inertia)")
    plt.grid(True)
    plt.tight_layout()
    elbow_plot_path = OUTPUTS / "elbow_plot.png"
    plt.savefig(elbow_plot_path)
    plt.close()

    print(f"✅ Optimal K determined by Elbow Method: {elbow_k}")
    return elbow_k


def train_and_cluster(csv_path: str, k: int = None):
    """
    Train K-Means clustering with higher weight on latitude/longitude.
    Still considers load_kg, but less influence.
    """
    df = pd.read_csv(csv_path)

    required = {"farmer_id", "village", "latitude", "longitude", "load_kg"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"CSV missing columns: {missing}")

    # ✅ Feature engineering: give more weight to geographic proximity
    df["latitude_weighted"] = df["latitude"] * 10     # Geography dominates
    df["longitude_weighted"] = df["longitude"] * 10
    df["load_scaled"] = df["load_kg"] / 100           # Normalize load impact

    # Select features
    X = df[["latitude_weighted", "longitude_weighted", "load_scaled"]]

    # Scale features uniformly
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # Auto-select k if not given
    if k is None or k <= 0:
        k = find_optimal_k(X_scaled, k_min=3, k_max=8)

    # Train K-Means
    kmeans = KMeans(n_clusters=k, random_state=42, n_init=20, max_iter=500)
    labels = kmeans.fit_predict(X_scaled)

    # Save artifacts
    joblib.dump(
        {"scaler": scaler, "kmeans": kmeans, "columns": X.columns.tolist()},
        MODELS / "cluster_artifacts.joblib"
    )

    # Add cluster info
    df_out = df.copy()
    df_out["cluster"] = labels
    out_csv = OUTPUTS / "clustered.csv"
    df_out.to_csv(out_csv, index=False)

    print(f"✅ Trained {k}-cluster KMeans on {len(df_out)} rows.")
    print(df_out['cluster'].value_counts())

    return df_out, str(out_csv)
