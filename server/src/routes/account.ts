import { Router } from 'express'
import { FieldValue } from 'firebase-admin/firestore'
import {
  requireAuth,
  type AuthedRequest,
} from '../middleware/auth.js'
import { db } from '../firebaseAdmin.js'

export const accountRouter = Router()

// EVERY account route below requires a valid Firebase user.
accountRouter.use(requireAuth)

accountRouter.post(
  '/bootstrap',
  async (req: AuthedRequest, res, next) => {
    try {
      const uid = req.uid

      if (!uid || typeof uid !== 'string' || !uid.trim()) {
        return res.status(401).json({
          error: 'Authenticated user UID is missing.',
        })
      }

      const walletRef = db()
        .collection('wallets')
        .doc(uid)

      const profileRef = db()
        .collection('profiles')
        .doc(uid)

      await db().runTransaction(async (tx) => {
        // Firestore requires ALL reads before ANY writes.
        const [walletSnap, profileSnap] =
          await Promise.all([
            tx.get(walletRef),
            tx.get(profileRef),
          ])

        if (!walletSnap.exists) {
          tx.set(walletRef, {
            virtualBalance: '10000',
            buyingPower: '10000',
            portfolioValue: '10000',
            totalPnL: '0',
            totalReturnPercent: '0',
            accountResets: 0,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          })
        }

        if (!profileSnap.exists) {
          tx.set(profileRef, {
            uid,
            email: req.email || '',
            displayName:
              req.body?.displayName?.trim() ||
              req.email?.split('@')[0] ||
              'Trader',
            preferredLanguage: 'en',
            themeColor: 'blue',
            experienceLevel: 'beginner',
            onboardingCompleted: false,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          })
        }
      })

      return res.json({
        ok: true,
      })
    } catch (error) {
      next(error)
    }
  },
)

accountRouter.get(
  '/summary',
  async (req: AuthedRequest, res, next) => {
    try {
      const uid = req.uid

      if (!uid || typeof uid !== 'string' || !uid.trim()) {
        return res.status(401).json({
          error: 'Authenticated user UID is missing.',
        })
      }

      const walletRef = db()
        .collection('wallets')
        .doc(uid)

      const profileRef = db()
        .collection('profiles')
        .doc(uid)

      const positionsRef = db()
        .collection('positions')
        .doc(uid)
        .collection('items')

      const tradesRef = db()
        .collection('trades')
        .doc(uid)
        .collection('items')

      const [
        walletSnap,
        profileSnap,
        positionsSnap,
        tradesSnap,
      ] = await Promise.all([
        walletRef.get(),
        profileRef.get(),

        positionsRef
          .where('status', '==', 'open')
          .get(),

        tradesRef
          .orderBy('closedAt', 'desc')
          .limit(10)
          .get()
          .catch(() => null),
      ])

      return res.json({
        wallet: walletSnap.exists
          ? walletSnap.data()
          : null,

        profile: profileSnap.exists
          ? profileSnap.data()
          : null,

        positions: positionsSnap.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })),

        recentTrades: tradesSnap
          ? tradesSnap.docs.map((doc) => ({
              id: doc.id,
              ...doc.data(),
            }))
          : [],
      })
    } catch (error) {
      next(error)
    }
  },
)

accountRouter.post(
  '/reset',
  async (req: AuthedRequest, res, next) => {
    try {
      const uid = req.uid

      if (!uid || typeof uid !== 'string' || !uid.trim()) {
        return res.status(401).json({
          error: 'Authenticated user UID is missing.',
        })
      }

      const batch = db().batch()

      const positionsRef = db()
        .collection('positions')
        .doc(uid)
        .collection('items')

      const positionsSnap =
        await positionsRef.get()

      positionsSnap.docs.forEach((position) => {
        batch.delete(position.ref)
      })

      const walletRef = db()
        .collection('wallets')
        .doc(uid)

      batch.set(
        walletRef,
        {
          virtualBalance: '10000',
          buyingPower: '10000',
          portfolioValue: '10000',
          totalPnL: '0',
          totalReturnPercent: '0',
          accountResets: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        {
          merge: true,
        },
      )

      await batch.commit()

      return res.json({
        ok: true,
      })
    } catch (error) {
      next(error)
    }
  },
)