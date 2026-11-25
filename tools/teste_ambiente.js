// Teste de ambiente: confere se $where, mapReduce e $function executam
// no servidor. Usa um banco descartável (teste_ambiente), apagado no final.
db = db.getSiblingDB("teste_ambiente");
print("db atual: " + db.getName());
db.t.drop();
db.t.insertMany([{c:"Recife",km:10,a:3,b:1},{c:"Recife",km:5,a:1,b:2},{c:"Olinda",km:7,a:2,b:2}]);
print("$where: " + db.t.find({ $where: function () { return this.a > this.b; } }).count());
const mr = db.t.mapReduce(function(){ emit(this.c, this.km); }, function(k,v){ return Array.sum(v); }, { out: { inline: 1 } });
printjson(mr);
printjson(db.t.aggregate([{ $project: { _id:0, c:1, dobro: { $function: { body: function(x){ return x*2; }, args: ["$km"], lang: "js" } } } }]).toArray());
db.dropDatabase();
