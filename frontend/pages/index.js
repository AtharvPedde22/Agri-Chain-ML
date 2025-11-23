import axios from "axios";
import { useEffect, useState, useCallback, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

export default function Home() {
  const API = process.env.NEXT_PUBLIC_API;

  const [farmers, setFarmers] = useState([]);
  const [stats, setStats] = useState({ byCluster: [], byTruck: [] });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [clusterFilter, setClusterFilter] = useState("all");
  const [capacity, setCapacity] = useState(5000); // 🚛 Dynamic capacity

  // ✅ Fetch farmers
  const fetchFarmers = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/api/farmers`);
      setFarmers(r.data);
    } catch (e) {
      console.error("Failed to fetch farmers:", e.message);
    }
  }, [API]);

  // ✅ Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/api/stats`);
      setStats(r.data);
    } catch (e) {
      console.error("Failed to fetch stats:", e.message);
    }
  }, [API]);

  useEffect(() => {
    fetchFarmers();
    fetchStats();
  }, [fetchFarmers, fetchStats]);

  // 📤 Upload CSV
  async function uploadCSV() {
    if (!file) return alert("Choose a CSV first");
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await axios.post(`${API}/api/upload-csv`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      alert("✅ CSV uploaded successfully and sent to ML service.");
      await fetchFarmers();
      await fetchStats();
    } catch (e) {
      alert(`Upload failed: ${e.response?.data?.error || e.message}`);
    } finally {
      setBusy(false);
    }
  }

  // 🧠 Train model
  async function train() {
    setBusy(true);
    try {
      await axios.post(`${API}/api/train`, { k: 5 });
      alert("✅ Training complete (k=5).");
      await fetchFarmers();
      await fetchStats();
    } catch (e) {
      alert(`Train failed: ${e.response?.data?.error || e.message}`);
    } finally {
      setBusy(false);
    }
  }

  // 🚛 Assign trucks (auto-refresh + scroll + feedback)
  async function assign() {
    setBusy(true);
    try {
      const res = await axios.post(`${API}/api/assign`, { capacity });
      alert(`✅ Truck assignment complete (${res.data.persisted} farmers updated).`);

      // Auto-refresh
      await Promise.all([fetchFarmers(), fetchStats()]);

      // Smooth scroll to table
      setTimeout(() => {
        const table = document.querySelector("table");
        if (table) table.scrollIntoView({ behavior: "smooth" });
      }, 400);
    } catch (e) {
      console.error("Assign error:", e);
      alert(`❌ Assign failed: ${e.response?.data?.error || e.message}`);
    } finally {
      setBusy(false);
    }
  }

  // 🎯 Cluster options for dropdown
  const clusterOptions = useMemo(() => {
    const list =
      stats.byCluster?.map((c) => String(c.cluster)) ??
      Array.from(
        new Set(
          farmers
            .map((f) => (f.cluster ?? "").toString())
            .filter((v) => v !== "")
        )
      );
    return Array.from(new Set(list)).sort((a, b) => Number(a) - Number(b));
  }, [stats.byCluster, farmers]);

  // 🧾 Filtered farmers for display
  const shownFarmers = useMemo(() => {
    if (clusterFilter === "all") return farmers;
    return farmers.filter(
      (f) => String(f.cluster ?? "") === String(clusterFilter)
    );
  }, [farmers, clusterFilter]);

  // 📥 Download filtered CSV
  function downloadCSV() {
    const rows = shownFarmers;
    if (!rows.length) return alert("No data to export!");
    const header = Object.keys(rows[0]);
    const csv = [
      header.join(","),
      ...rows.map((r) => header.map((h) => r[h] ?? "").join(",")),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      clusterFilter === "all"
        ? "farmers_all_clusters.csv"
        : `cluster_${clusterFilter}_farmers.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // 📊 Calculate Truck Utilization
  const truckUtilization = useMemo(() => {
    if (!farmers.length) return 0;
    const totalLoad = farmers.reduce((s, f) => s + (f.load_kg || 0), 0);
    const uniqueTrucks = new Set(farmers.map((f) => f.assigned_truck)).size;
    const totalTruckCapacity = uniqueTrucks * capacity;
    return totalTruckCapacity
      ? ((totalLoad / totalTruckCapacity) * 100).toFixed(1)
      : 0;
  }, [farmers, capacity]);

  return (
    <div
      style={{
        padding: 20,
        fontFamily: "Inter, system-ui",
        color: "white",
        background: "#111",
        minHeight: "100vh",
      }}
    >
      <h1>Grain Pickup Dashboard</h1>

      {/* Top Controls */}
      <div style={{ display: "flex", gap: 12, margin: "12px 0", flexWrap: "wrap" }}>
        <input
          type="file"
          accept=".csv"
          onChange={(e) => setFile(e.target.files[0])}
        />
        <button disabled={busy} onClick={uploadCSV}>
          Upload CSV
        </button>
        <button disabled={busy} onClick={train}>
          Train (k=5)
        </button>

        {/* 🚛 Dynamic Capacity Selector */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label>Truck Capacity:</label>
          <select
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value))}
            style={{
              background: "#1a1a1a",
              color: "white",
              padding: "4px 8px",
              borderRadius: 6,
            }}
          >
            <option value={5000}>5000 kg</option>
            <option value={7000}>7000 kg</option>
            <option value={10000}>10000 kg</option>
          </select>
        </div>

        <button disabled={busy} onClick={assign}>
          {busy ? "⏳ Assigning..." : `Assign (${capacity} kg)`}
        </button>
      </div>

      {/* Summary + Filter */}
      <h2>Summary</h2>
      <div
        style={{
          display: "flex",
          gap: 24,
          marginBottom: 16,
          fontSize: 16,
          background: "#181818",
          padding: "10px 16px",
          borderRadius: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div>👨‍🌾 Total Farmers: {farmers.length}</div>
        <div>🧩 Total Clusters: {stats.byCluster.length}</div>
        <div>🚛 Total Trucks: {stats.byTruck.length}</div>
        <div>📈 Utilization: {truckUtilization}%</div>

        {/* Filter + Download */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label htmlFor="clusterSelect">Filter by Cluster:</label>
          <select
            id="clusterSelect"
            value={clusterFilter}
            onChange={(e) => setClusterFilter(e.target.value)}
            style={{
              background: "#1a1a1a",
              color: "white",
              padding: "6px 8px",
              borderRadius: 6,
            }}
          >
            <option value="all">All</option>
            {clusterOptions.map((c) => (
              <option key={c} value={c}>
                Cluster {c}
              </option>
            ))}
          </select>

          {clusterFilter !== "all" && (
            <button onClick={() => setClusterFilter("all")}>Clear</button>
          )}

          <button onClick={downloadCSV} style={{ marginLeft: 8 }}>
            ⬇️ Download CSV
          </button>
        </div>
      </div>

      {/* Cluster Load Chart */}
      <div
        style={{
          background: "#111",
          padding: 20,
          borderRadius: 10,
          marginBottom: 30,
        }}
      >
        <h3 style={{ marginBottom: 10 }}>Cluster Load Distribution</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart
            data={stats.byCluster}
            margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#444" />
            <XAxis dataKey="cluster" stroke="#ccc" />
            <YAxis stroke="#ccc" />
            <Tooltip
              contentStyle={{ background: "#222", border: "none" }}
              labelStyle={{ color: "#fff" }}
            />
            <Legend />
            <Bar dataKey="cnt" name="Farmers" fill="#00bcd4" />
            <Bar dataKey="total_kg" name="Total Load (kg)" fill="#ffc107" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Farmers Table */}
      <h3>
        Farmers (preview)
        {clusterFilter !== "all" ? ` — Cluster ${clusterFilter}` : ""}
      </h3>
      <table
        border="1"
        cellPadding="6"
        style={{
          color: "white",
          borderColor: "#666",
          width: "100%",
          background: "#1a1a1a",
        }}
      >
        <thead style={{ background: "#333" }}>
          <tr>
            <th>farmer_id</th>
            <th>village</th>
            <th>latitude</th>
            <th>longitude</th>
            <th>load_kg</th>
            <th>cluster</th>
            <th>truck</th>
          </tr>
        </thead>
        <tbody>
          {shownFarmers.slice(0, 1000).map((f) => (
            <tr key={f.farmer_id}>
              <td>{f.farmer_id}</td>
              <td>{f.village}</td>
              <td>{f.latitude}</td>
              <td>{f.longitude}</td>
              <td>{f.load_kg}</td>
              <td>{f.cluster ?? ""}</td>
              <td>{f.assigned_truck ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
