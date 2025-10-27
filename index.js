// server/http.ts
import { createServer } from "http";

// app/app.ts
import express from "express";
import path3 from "node:path";
import expressLayouts from "express-ejs-layouts";

// app/routes/router.ts
import { Router as Router3 } from "express";

// app/routes/create-router.ts
import { Router } from "express";

// libs/dotDB/Schema.ts
import { z } from "zod";
var Schema = class {
  /**
   * Crée une nouvelle instance de Schema
   * @constructor
   * @param {T} schemaDefinition - Définition du schéma utilisant les types Zod
   */
  constructor(schemaDefinition) {
    /** Ensemble des champs marqués comme uniques */
    this.uniqueFields = /* @__PURE__ */ new Set();
    this.schema = z.object(schemaDefinition);
  }
  /**
   * Marque un champ comme étant unique dans la collection
   * @param field Le nom du champ à marquer comme unique
   */
  unique(field) {
    this.uniqueFields.add(field);
    return this;
  }
  /**
   * Récupère la liste des champs uniques
   */
  getUniqueFields() {
    return Array.from(this.uniqueFields);
  }
  /**
   * Valide des données contre le schéma
   * @param {any} data - Données à valider
   * @returns {boolean} True si les données sont valides, False sinon
   */
  parse(data) {
    return this.schema.safeParse(data);
  }
};

// libs/dotDB/Driver.ts
import fs from "fs/promises";

// libs/dotDB/ObjectId.ts
var ObjectId = class _ObjectId {
  static {
    /** Compteur statique pour la génération séquentielle */
    this.counter = Math.floor(Math.random() * 16777215);
  }
  /**
   * Crée un nouvel ObjectId
   * @constructor
   * Génère un ID unique composé de : timestamp-processId-counter
   */
  constructor() {
    const timestamp = Math.floor(Date.now() / 1e3).toString(16);
    const processId = Math.floor(Math.random() * 65535).toString(16).padStart(4, "0");
    const increment = (_ObjectId.counter++ % 16777215).toString(16).padStart(6, "0");
    this.value = `${timestamp}-${processId}-${increment}`;
  }
  /**
   * Convertit l'ObjectId en chaîne de caractères
   * @returns {string} Représentation string de l'ObjectId
   */
  toString() {
    return this.value;
  }
  /**
   * Crée un ObjectId à partir d'une chaîne
   */
  static from(id) {
    const objectId = new _ObjectId();
    if (!_ObjectId.isValid(id)) {
      throw new Error("Invalid ObjectId format");
    }
    objectId.value = id;
    return objectId;
  }
  /**
   * Vérifie si une chaîne est un ObjectId valide
   */
  static isValid(id) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{6}$/i.test(id);
  }
  /**
   * Compare deux ObjectId
   */
  equals(other) {
    return this.value === other.value;
  }
  /**
   * Récupère le timestamp de création
   */
  getTimestamp() {
    const timestamp = parseInt(this.value.split("-")[0], 16);
    return new Date(timestamp * 1e3);
  }
};

// libs/dotDB/Driver.ts
var Driver = class {
  constructor(configs) {
    this.configs = configs;
    this.MemoryStorage = {};
  }
  async createCollection(name) {
    try {
      const filePath = `${this.configs.storagePath}/${name}.db.collection.json`;
      await fs.mkdir(this.configs.storagePath, { recursive: true });
      try {
        await fs.access(filePath);
      } catch {
        await fs.writeFile(filePath, "[]");
      }
    } catch (error) {
      console.error(`Erreur lors de la cr\xE9ation de la collection ${name}:`, error);
      throw error;
    }
  }
  async checkUnique(collectionName, field, value) {
    try {
      const filePath = `${this.configs.storagePath}/${collectionName}.db.collection.json`;
      let documents = [];
      try {
        const content = await fs.readFile(filePath, "utf-8");
        documents = JSON.parse(content);
      } catch {
        return true;
      }
      return !documents.some((doc) => doc[field] === value);
    } catch (error) {
      console.error(`Erreur lors de la v\xE9rification d'unicit\xE9 dans ${collectionName}:`, error);
      throw error;
    }
  }
  createMatchFunction(filter) {
    return (doc) => {
      for (const [key, value] of Object.entries(filter)) {
        if (value === void 0) continue;
        if (key === "_id") {
          const docId = doc._id.toString();
          const filterId = value instanceof ObjectId ? value.toString() : value;
          if (docId !== filterId) return false;
          continue;
        }
        if (typeof value === "object" && value !== null) {
          if ("$eq" in value && doc[key] !== value.$eq) return false;
          if ("$ne" in value && doc[key] === value.$ne) return false;
          if ("$gt" in value && doc[key] <= value.$gt) return false;
          if ("$gte" in value && doc[key] < value.$gte) return false;
          if ("$lt" in value && doc[key] >= value.$lt) return false;
          if ("$lte" in value && doc[key] > value.$lte) return false;
          if ("$in" in value && !value.$in.includes(doc[key])) return false;
          if ("$nin" in value && value.$nin.includes(doc[key])) return false;
          if ("$exists" in value && doc[key] === void 0 === value.$exists) return false;
          if ("$regex" in value) {
            const regex = typeof value.$regex === "string" ? new RegExp(value.$regex) : value.$regex;
            if (!regex.test(doc[key])) return false;
          }
        } else if (doc[key] !== value) {
          return false;
        }
      }
      return true;
    };
  }
  applyUpdate(doc, update) {
    if (update.$set) {
      Object.assign(doc, update.$set);
    }
    if (update.$unset) {
      for (const key of Object.keys(update.$unset)) {
        delete doc[key];
      }
    }
    if (update.$inc) {
      for (const [key, value] of Object.entries(update.$inc)) {
        doc[key] = (doc[key] || 0) + value;
      }
    }
    if (update.$push) {
      for (const [key, value] of Object.entries(update.$push)) {
        if (!Array.isArray(doc[key])) doc[key] = [];
        doc[key].push(value);
      }
    }
    if (update.$pull) {
      for (const [key, value] of Object.entries(update.$pull)) {
        if (Array.isArray(doc[key])) {
          doc[key] = doc[key].filter((item) => item !== value);
        }
      }
    }
  }
  async createDocument(collectionName, data, uniqueFields = []) {
    try {
      const filePath = `${this.configs.storagePath}/${collectionName}.db.collection.json`;
      let documents = [];
      for (const field of uniqueFields) {
        const isUnique = await this.checkUnique(collectionName, field, data[field]);
        if (!isUnique) {
          throw new Error(`La valeur '${data[field]}' existe d\xE9j\xE0 pour le champ '${field}'`);
        }
      }
      try {
        const content = await fs.readFile(filePath, "utf-8");
        documents = JSON.parse(content);
      } catch (error) {
        await this.createCollection(collectionName);
      }
      const doc = { _id: new ObjectId().toString(), ...data };
      documents.push(doc);
      await fs.writeFile(filePath, JSON.stringify(documents, null, 2));
      return doc;
    } catch (error) {
      console.error(`Erreur lors de la cr\xE9ation du document dans ${collectionName}:`, error);
      throw error;
    }
  }
  async findDocuments(collectionName, filter = {}, options = {}) {
    try {
      const filePath = `${this.configs.storagePath}/${collectionName}.db.collection.json`;
      let documents = [];
      try {
        const content = await fs.readFile(filePath, "utf-8");
        documents = JSON.parse(content);
      } catch {
        return [];
      }
      const matchFn = this.createMatchFunction(filter);
      let results = documents.filter(matchFn);
      if (options.sort) {
        for (const [key, order] of Object.entries(options.sort)) {
          results.sort((a, b) => {
            if (a[key] < b[key]) return order === 1 ? -1 : 1;
            if (a[key] > b[key]) return order === 1 ? 1 : -1;
            return 0;
          });
        }
      }
      if (options.skip) results = results.slice(options.skip);
      if (options.limit) results = results.slice(0, options.limit);
      if (options.projection) {
        return results.map((doc) => {
          const projected = { _id: doc._id };
          for (const [key, include] of Object.entries(options.projection)) {
            if (include === 1) projected[key] = doc[key];
          }
          return projected;
        });
      }
      return results;
    } catch (error) {
      console.error(`Erreur lors de la recherche dans ${collectionName}:`, error);
      throw error;
    }
  }
  async updateDocuments(collectionName, filter, update) {
    try {
      const filePath = `${this.configs.storagePath}/${collectionName}.db.collection.json`;
      let documents = [];
      try {
        const content = await fs.readFile(filePath, "utf-8");
        documents = JSON.parse(content);
      } catch {
        return 0;
      }
      const matchFn = this.createMatchFunction(filter);
      let modifiedCount = 0;
      documents = documents.map((doc) => {
        if (matchFn(doc)) {
          modifiedCount++;
          this.applyUpdate(doc, update);
        }
        return doc;
      });
      await fs.writeFile(filePath, JSON.stringify(documents, null, 2));
      return modifiedCount;
    } catch (error) {
      console.error(`Erreur lors de la mise \xE0 jour dans ${collectionName}:`, error);
      throw error;
    }
  }
  async deleteDocuments(collectionName, filter) {
    try {
      const filePath = `${this.configs.storagePath}/${collectionName}.db.collection.json`;
      let documents = [];
      try {
        const content = await fs.readFile(filePath, "utf-8");
        documents = JSON.parse(content);
      } catch {
        return 0;
      }
      const matchFn = this.createMatchFunction(filter);
      const originalLength = documents.length;
      documents = documents.filter((doc) => !matchFn(doc));
      const deletedCount = originalLength - documents.length;
      await fs.writeFile(filePath, JSON.stringify(documents, null, 2));
      return deletedCount;
    } catch (error) {
      console.error(`Erreur lors de la suppression dans ${collectionName}:`, error);
      throw error;
    }
  }
};

// libs/dotDB/Model.ts
var Model = class {
  /**
   * Crée une nouvelle instance de Model
   * @constructor
   * @param {string} name - Nom de la collection
   * @param {Schema} _schema - Schéma de validation Zod
   * @param {Driver} driver - Instance du driver pour les opérations bas niveau
   */
  constructor(name, _schema, driver) {
    this.name = name;
    this._schema = _schema;
    this.driver = driver;
  }
  /**
   * Crée un nouveau document dans la collection
   * @async
   * @param {z.infer<T>} data - Données à insérer conformes au schéma
   * @returns {Promise<z.infer<T> & DocumentType>} Document créé avec son _id
   * @throws {Error} Si les données sont invalides ou si un champ unique est dupliqué
   */
  async create(data) {
    try {
      const result = this._schema.parse(data);
      if (!result.error) {
        throw new Error("Invalid data according to schema: " + result.error?.message);
      }
      const uniqueFields = this._schema.getUniqueFields();
      const doc = await this.driver.createDocument(
        this.name,
        result.data || data,
        uniqueFields
      );
      return doc;
    } catch (error) {
      throw error;
    }
  }
  /**
   * Recherche des documents dans la collection
   * @async
   * @param {FilterQuery<z.infer<T>>} filter - Critères de recherche
   * @param {FindOptions} options - Options de recherche (tri, limite, projection)
   * @returns {Promise<Array<z.infer<T> & DocumentType>>} Liste des documents trouvés
   * @throws {Error} En cas d'erreur de recherche
   */
  async find(filter = {}, options = {}) {
    try {
      return await this.driver.findDocuments(this.name, filter, options);
    } catch (error) {
      throw error;
    }
  }
  /**
   * Recherche un seul document dans la collection
   * @async
   * @param {FilterQuery<z.infer<T>>} filter - Critères de recherche
   * @param {FindOptions} options - Options de recherche
   * @returns {Promise<(z.infer<T> & DocumentType) | null>} Document trouvé ou null
   * @throws {Error} En cas d'erreur de recherche
   */
  async findOne(filter, options = {}) {
    try {
      const [result] = await this.find(filter, { ...options, limit: 1 });
      return result || null;
    } catch (error) {
      throw error;
    }
  }
  /**
   * Recherche un document par son ID
   * @async
   * @param {string | ObjectId} id - ID du document à rechercher
   * @param {FindOptions} options - Options de recherche
   * @returns {Promise<(z.infer<T> & DocumentType) | null>} Document trouvé ou null
   */
  async findById(id, options = {}) {
    const idStr = id instanceof ObjectId ? id.toString() : id;
    return this.findOne({ _id: idStr }, options);
  }
  /**
   * Met à jour plusieurs documents dans la collection
   * @async
   * @param {FilterQuery<z.infer<T>>} filter - Critères de sélection des documents
   * @param {UpdateQuery<z.infer<T>>} update - Modifications à appliquer
   * @returns {Promise<number>} Nombre de documents mis à jour
   * @throws {Error} En cas d'erreur de mise à jour
   */
  async updateMany(filter, update) {
    try {
      return await this.driver.updateDocuments(this.name, filter, update);
    } catch (error) {
      throw error;
    }
  }
  /**
   * Met à jour un seul document dans la collection
   * @async
   * @param {FilterQuery<z.infer<T>>} filter - Critères de sélection du document
   * @param {UpdateQuery<z.infer<T>>} update - Modifications à appliquer
   * @returns {Promise<boolean>} True si un document a été mis à jour, False sinon
   * @throws {Error} En cas d'erreur de mise à jour
   */
  async updateOne(filter, update) {
    try {
      const count = await this.updateMany(filter, update);
      return count > 0;
    } catch (error) {
      throw error;
    }
  }
  /**
   * Met à jour un document par son ID
   * @async
   * @param {string | ObjectId} id - ID du document à mettre à jour
   * @param {UpdateQuery<z.infer<T>>} update - Modifications à appliquer
   * @returns {Promise<boolean>} True si le document a été mis à jour, False sinon
   */
  async updateById(id, update) {
    const idStr = id instanceof ObjectId ? id.toString() : id;
    return this.updateOne({ _id: idStr }, update);
  }
  /**
   * Supprime plusieurs documents de la collection
   * @async
   * @param {FilterQuery<z.infer<T>>} filter - Critères de sélection des documents
   * @returns {Promise<number>} Nombre de documents supprimés
   * @throws {Error} En cas d'erreur de suppression
   */
  async deleteMany(filter) {
    try {
      return await this.driver.deleteDocuments(this.name, filter);
    } catch (error) {
      throw error;
    }
  }
  /**
   * Supprime un seul document de la collection
   * @async
   * @param {FilterQuery<z.infer<T>>} filter - Critères de sélection du document
   * @returns {Promise<boolean>} True si un document a été supprimé, False sinon
   * @throws {Error} En cas d'erreur de suppression
   */
  async deleteOne(filter) {
    try {
      const count = await this.deleteMany(filter);
      return count > 0;
    } catch (error) {
      throw error;
    }
  }
  /**
   * Supprime un document par son ID
   * @async
   * @param {string | ObjectId} id - ID du document à supprimer
   * @returns {Promise<boolean>} True si le document a été supprimé, False sinon
   */
  async deleteById(id) {
    const idStr = id instanceof ObjectId ? id.toString() : id;
    return this.deleteOne({ _id: idStr });
  }
  // Méthodes utilitaires
  /**
   * Vérifie si un document existe dans la collection
   * @async
   * @param {FilterQuery<z.infer<T>>} filter - Critères de recherche
   * @returns {Promise<boolean>} True si un document correspondant existe, False sinon
   * @throws {Error} En cas d'erreur de recherche
   */
  async exists(filter) {
    try {
      const doc = await this.findOne(filter, { projection: { _id: 1 } });
      return doc !== null;
    } catch (error) {
      throw error;
    }
  }
  /**
   * Compte le nombre de documents correspondant au filtre
   * @async
   * @param {FilterQuery<z.infer<T>>} filter - Critères de sélection
   * @returns {Promise<number>} Nombre de documents correspondants
   * @throws {Error} En cas d'erreur de comptage
   */
  async count(filter = {}) {
    try {
      const docs = await this.find(filter);
      return docs.length;
    } catch (error) {
      throw error;
    }
  }
  /**
   * Récupère les valeurs distinctes d'un champ
   * @async
   * @param {keyof z.infer<T> & string} field - Nom du champ
   * @param {FilterQuery<z.infer<T>>} filter - Filtre optionnel
   * @returns {Promise<any[]>} Tableau des valeurs distinctes
   * @throws {Error} En cas d'erreur de récupération
   */
  async distinct(field, filter = {}) {
    try {
      const docs = await this.find(filter);
      const values = docs.map((doc) => doc[field]);
      return [...new Set(values)];
    } catch (error) {
      throw error;
    }
  }
};

// libs/dotDB/JSONDatabase.ts
var JSONDatabase = class {
  constructor() {
    this.configs = {
      storagePath: "./database"
    };
    this.driver = new Driver(this.configs);
  }
  root(path4) {
    this.configs.storagePath = path4;
  }
  model(name, schema) {
    this.driver.createCollection(name);
    return new Model(name, schema, this.driver);
  }
  connect() {
  }
  disconnect() {
  }
};

// app/configs/db.ts
var db = new JSONDatabase();
db.root("database");
var db_default = db;

// app/models/Formula.ts
var formulaSchema = new Schema({
  name: z.string(),
  description: z.string(),
  m3uFileUrl: z.string(),
  priceFor30Days: z.number()
});
formulaSchema.unique("name").unique("m3uFileUrl");
var Formula = db_default.model("Formula", formulaSchema);

// app/models/Subscription.ts
var subscriptionSchema = new Schema({
  formulaId: z.string(),
  maxConnection: z.number().min(1).default(1),
  phoneNumber: z.number().optional(),
  price: z.number(),
  duration_days: z.number().min(1).default(3),
  status: z.enum(["PAID", "PENDING", "TRIAL"]).default("PENDING"),
  createAt: z.number(),
  expireAt: z.number()
});
var Subscription = db_default.model("Subscription", subscriptionSchema);

// app/controllers/create-controller.ts
var dirname = import.meta.dirname;
async function createFormulaController(req, res) {
  if (!req.file) {
    res.status(400).json({ message: "No file uploaded" });
    return;
  }
  const formula = Formula.create({
    name: req.body.name,
    description: req.body.description,
    m3uFileUrl: req.file.filename,
    priceFor30Days: req.body.price
  }).then((doc) => res.status(200).json(doc)).catch((err) => {
    console.log(err);
    res.status(500).json({ message: "Internal server error" });
  });
}
async function createSubscriptionController(req, res) {
  if (!req.body) {
    console.log(req.body);
    console.log("Bad Request from user");
    return res.status(400).json({ message: "Bad Request" });
  }
  if (!req.body.formula_id) return res.status(400).send({ message: "FormulaId is Required" });
  const formula = await Formula.findById(req.body.formula_id);
  if (!formula) {
    return res.status(400).send({ message: "Formula not found" });
  }
  if (!req.body.duration_days || req.body.duration_days < 30) {
    req.body.duration_days = 3;
  }
  Subscription.create({
    formulaId: formula._id,
    phoneNumber: req.body.phone_number,
    status: req.body.status,
    price: req.body.duration_days === 3 ? 0 : req.body.duration_days * formula.priceFor30Days / 30,
    createAt: Date.now(),
    duration_days: req.body.duration_days,
    expireAt: Date.now() + req.body.duration_days * 24 * 60 * 60 * 1e3,
    maxConnection: req.body.max_connections
  }).then((subscription) => {
    subscription.path = "/subscription/" + subscription._id + "/index.m3u";
    console.log("Subscription created successfully");
    console.log("Subscription path: " + subscription.path);
    res.json(subscription);
  }).catch((err) => {
    console.log(err);
    res.status(500).json({ message: "Internal server error" });
  });
}

// app/routes/create-router.ts
import multer from "multer";
import path from "node:path";
var dirname2 = import.meta.dirname;
var createRouter = Router();
var storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(process.cwd(), "app", "uploads", "m3u-playlist"));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix + ext);
  }
});
var upload = multer({ storage });
createRouter.route("/formula").get((req, res) => res.render("create/formula")).post(upload.single("m3u-file"), createFormulaController);
createRouter.route("/subscription").get((req, res) => res.render("create/subscription")).post(upload.none(), createSubscriptionController);
var create_router_default = createRouter;

// app/routes/data-router.ts
import { Router as Router2 } from "express";
var dataRouter = new Router2();
dataRouter.route("/formula").get((req, res) => {
  Formula.find().then((formulas) => res.json(formulas)).catch((err) => {
    console.error("Error fetching formulas:", err);
    res.status(500).json({ message: "Internal server error" });
  });
});
var data_router_default = dataRouter;

// app/routes/router.ts
import path2 from "node:path";
var router = new Router3();
router.use("/create", create_router_default);
router.use("/data", data_router_default);
router.get("/subscription/:id/index.m3u", async (req, res) => {
  const subscriptionId = req.params.id;
  const subscription = await Subscription.findById(subscriptionId);
  if (!subscription) {
    return res.status(404).json({ message: "Subscription not found" });
  }
  const formula = await Formula.findById(subscription.formulaId);
  if (!formula) {
    return res.status(404).json({ message: "Formula not found" });
  }
  if (!(subscription.expireAt > Date.now())) {
    await Subscription.deleteOne({ _id: subscriptionId });
    res.status(403).send("Subscription Expired, Now Server Delete It");
  }
  res.sendFile(path2.join(process.cwd(), "app", "uploads/m3u-playlist", formula.m3uFileUrl));
});
var router_default = router;

// app/app.ts
var dirname3 = import.meta.dirname;
var app = express();
app.use(express.static(path3.join(dirname3, "public")));
app.set("view engine", "ejs");
app.set("views", path3.join(process.cwd(), "app", "views"));
app.use(expressLayouts);
app.set("layout", "layouts/layout");
app.use(router_default);
var app_default = app;

// server/http.ts
var server = createServer(app_default);
var runServer = (port) => {
  server.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
  });
};

// index.ts
runServer(800);
