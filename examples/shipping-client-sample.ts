/**
 * Demonstration client for API Guardian's logistics OpenAPI example.
 * This intentionally reads the v1 `estimated_delivery` field so the impact
 * scanner has a concrete client usage to find when comparing v1 with v2.
 */
export type ShipmentTrackingV1 = {
  shipment_id: string;
  status: "created" | "in_transit" | "delivered";
  estimated_delivery?: string;
};

export async function getShipmentTracking(baseUrl: string, shipmentId: string) {
  const endpoint = `${baseUrl}/shipments/${shipmentId}/tracking`;
  const response = await fetch(endpoint);

  if (!response.ok) {
    throw new Error(`Shipment tracking request failed: ${response.status}`);
  }

  const tracking = (await response.json()) as ShipmentTrackingV1;
  return {
    id: tracking.shipment_id,
    status: tracking.status,
    estimatedDelivery: tracking.estimated_delivery
  };
}
