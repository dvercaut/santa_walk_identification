import firebase_admin
import random

from firebase_admin import credentials, db, firestore

cred = credentials.Certificate('santa-walk-identification-firebase-adminsdk-9iiz7-4e456d77cf.json')
firebase_admin.initialize_app(cred, {
  'projectId': 'santa-walk-identification',
})

db = firestore.client()
users_ref = db.collection(u'santa_walk_2018')
docs = users_ref.get()

res = [(doc.id, doc.to_dict()) for doc in docs]
winner = random.randint(0, len(res)-1)
print(u'{} => {}'.format(*res[winner]))
