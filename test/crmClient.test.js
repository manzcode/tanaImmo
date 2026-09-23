const { createLead } = require("../src/services/crmClient");

const lead = { listingId: "42", name: "Rakoto", phone: "0340000000" };

beforeEach(() => {
  process.env.CRM_API_TOKEN = "token-de-test";
  jest.spyOn(console, "warn").mockImplementation(() => {}); // cache les logs pendant les tests
});

afterEach(() => {
  jest.restoreAllMocks(); // remet le vrai fetch et le vrai console.warn
});

test("429 puis succès : attend le Retry-After, réessaie, puis renvoie le lead", async () => {
  // Le faux CRM répond 429, puis 201.
  const fakeFetch = jest
    .spyOn(global, "fetch")
    .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "1" } }))
    .mockResolvedValueOnce(Response.json({ id: "lead_1" }, { status: 201 }));

  const result = await createLead(lead);

  expect(result).toEqual({ id: "lead_1" });
  expect(fakeFetch).toHaveBeenCalledTimes(2);
});

test("500 trois fois : abandonne après 3 tentatives, avec la même clé", async () => {
  // Le faux CRM répond toujours 500.
  const fakeFetch = jest
    .spyOn(global, "fetch")
    .mockImplementation(async () => new Response(null, { status: 500 }));

  // Message EXACT : on est donc sûr que le token n'est pas dedans.
  await expect(createLead(lead)).rejects.toThrow(
    new Error("Lead non créé (HTTP 500) après 3 tentative(s)"),
  );

  expect(fakeFetch).toHaveBeenCalledTimes(3);

  // Les 3 appels ont la même clé d'idempotence.
  const keys = fakeFetch.mock.calls.map(([url, options]) => options.headers["Idempotency-Key"]);
  expect(new Set(keys).size).toBe(1);
});
