def pack_cluster(farmers, capacity):
    """
    Optimized Best-Fit Decreasing Truck Packing Algorithm
    -----------------------------------------------------
    farmers: list of dicts -> [{'farmer_id': str, 'load_kg': float}]
    capacity: float -> truck capacity limit (e.g., 5000)

    Returns: list of lists -> each list = farmer_ids assigned to a truck

    Note:
    - Latitude and longitude are not used for packing (only for clustering).
    - This algorithm focuses purely on efficient truck capacity utilization.
    """

    # ✅ Step 1: Ensure valid numeric loads and sort farmers in descending order
    valid_farmers = [f for f in farmers if float(f.get("load_kg", 0)) > 0]
    valid_farmers.sort(key=lambda x: float(x["load_kg"]), reverse=True)

    trucks = []

    # ✅ Step 2: Assign each farmer to the most suitable (best-fit) truck
    for f in valid_farmers:
        load = float(f["load_kg"])
        placed = False

        # Sort trucks by remaining capacity (ascending)
        trucks.sort(key=lambda t: t["remaining"])

        for t in trucks:
            # If this truck can still take the load, place it here
            if t["remaining"] >= load:
                t["farmers"].append(f["farmer_id"])
                t["remaining"] -= load
                placed = True
                break

        # If no existing truck fits, create a new one
        if not placed:
            trucks.append({
                "farmers": [f["farmer_id"]],
                "remaining": max(capacity - load, 0)
            })

    # ✅ Step 3: Return truck farmer lists
    return [t["farmers"] for t in trucks]
