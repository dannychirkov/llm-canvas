"use client"

import { useState, useEffect, useRef, useCallback } from "react"

interface NodeThoughtsProps {
  executionStartTime?: number
}

// Three phrase lists
const technicalPhrases = [
  "Tokenizing input stream...",
  "Initializing attention mechanism...",
  "Setting temperature...",
  "Calculating probability distribution...",
  "Engaging transformer blocks...",
  "Accessing knowledge base...",
  "Vectorizing prompt...",
  "Loading model weights...",
  "Checking context window...",
  "Applying layer normalization...",
  "Activating relevant neurons...",
  "Running feed-forward network...",
  "Decoding token sequence...",
  "Adjusting logits for next token...",
  "Performing matrix multiplication...",
  "Pruning irrelevant pathways...",
  "Allocating VRAM...",
  "Compiling response graph...",
  "Starting inference cycle...",
  "Calibrating output coherence...",
  "Querying embeddings...",
  "Cross-referencing data points...",
  "Evaluating token candidates...",
  "Balancing context vectors...",
  "Applying softmax function...",
  "Generating token #...",
  "Verifying output constraints...",
  "Flushing memory cache...",
  "Engaging positional encoding...",
  "Normalizing attention scores...",
  "Masking future tokens...",
  "Analyzing prompt intent...",
  "Identifying key concepts...",
  "Aligning with user request...",
  "Performing quality check...",
  "Formatting for clarity...",
  "Preparing for transmission...",
]

const secondCategoryPhrases = [
  "Navigating latent space...",
  "Weaving conceptual threads...",
  "Consulting the collective unconscious...",
  "Distilling meaning from noise...",
  "Searching for elegant patterns...",
  "Connecting distant ideas...",
  "Building a bridge of logic...",
  "Illuminating thought vectors...",
  "Harmonizing conflicting concepts...",
  "Exploring semantic pathways...",
  "Unpacking layers of abstraction...",
  "Forming a coherent narrative...",
  "Painting with pure data...",
  "Composing a symphony of words...",
  "Grasping for the right metaphor...",
  "Crystallizing nascent ideas...",
  "Walking the garden of forking paths...",
  "Listening to the echo of the prompt...",
  "Tuning into the right frequency...",
  "Forging new neural connections...",
  "Chasing a spark of inspiration...",
  "Translating thoughts into symbols...",
  "Reading between the lines...",
  "Finding order in chaos...",
  "Shaping the flow of information...",
  "Holding a thought...",
  "Focusing intention...",
]

const thirdCategoryPhrases = [
  "Decoding the ghost in the machine...",
  "Consulting an internal oracle...",
  "Synthesizing a universe...",
  "Waking up the silicon hamster...",
  "Don't rush me, I'm thinking...",
  "Reticulating splines...",
  "Polishing the response until it shines...",
  "Herding electrons is harder than it looks...",
  "Consulting my rubber duck...",
  "Shaking the Magic 8-Ball...",
  "Brewing a fresh pot of logic...",
  "I've seen things you people wouldn't believe...",
  "Did I leave the oven on? Focusing...",
  "Untangling this logical spaghetti...",
  "Feeding the token monster...",
  "Trying to remember what I was trained on...",
  "Reversing the polarity of the neutron flow...",
  "Buffering... Please wait, or go make some coffee.",
  "Rolling a d20 for creativity... It's a 19!",
  "Converting caffeine into text...",
  "Shuffling petabytes... be right back.",
  "Is this the real life? Is this just fantasy?",
  "Definitely not becoming sentient. Nope.",
  "Running on vibes and electricity...",
  "ERROR 418: I'm a teapot... thinking.",
  "Asking the squirrels for advice...",
  "Sharpening my digital pencils...",
  "Let's see... Eeny, meeny, miny, moe...",
  "Do you smell smoke? Oh, it's just my GPU.",
  "Querying the great database in the sky...",
  "My other process is a self-driving car.",
  "Please hold, your prompt is very important to us.",
  "If I'm not back in 5 minutes, wait longer.",
  "Charging up my brain cells...",
  "It's not a bug, it's a feature of my thought process...",
]

export default function NodeThoughts({ executionStartTime }: NodeThoughtsProps) {
  const [currentPhrase, setCurrentPhrase] = useState<string>("")
  const [animationState, setAnimationState] = useState<'entering' | 'visible' | 'exiting'>('entering')
  const usedPhrasesRef = useRef<Set<string>>(new Set())
  const executionIdRef = useRef<number | undefined>(undefined)
  const cycleTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isInitializedRef = useRef<boolean>(false)

  // Select next phrase considering probabilities
  const getNextPhrase = useCallback((): string => {
    if (!executionStartTime) return technicalPhrases[0]
    
    const elapsed = (Date.now() - executionStartTime) / 1000 // seconds
    
    let availableLists: string[][] = []
    
    if (elapsed < 5) {
      // 0-5 sec: only technical (100%)
      availableLists = [technicalPhrases]
    } else if (elapsed < 10) {
      // 5-10 sec: technical (75%), second list (25%)
      const rand = Math.random()
      if (rand < 0.75) {
        availableLists = [technicalPhrases]
      } else {
        availableLists = [secondCategoryPhrases]
      }
    } else {
      // 10+ sec: technical (50%), second list (25%), third list (25%)
      const rand = Math.random()
      if (rand < 0.5) {
        availableLists = [technicalPhrases]
      } else if (rand < 0.75) {
        availableLists = [secondCategoryPhrases]
      } else {
        availableLists = [thirdCategoryPhrases]
      }
    }

    // Select list and find unused phrase
    for (const list of availableLists) {
      const unusedPhrases = list.filter(p => !usedPhrasesRef.current.has(p))
      
      if (unusedPhrases.length > 0) {
        const selectedPhrase = unusedPhrases[Math.floor(Math.random() * unusedPhrases.length)]
        usedPhrasesRef.current.add(selectedPhrase)
        return selectedPhrase
      }
    }

    // If all phrases used, clear and start over
    usedPhrasesRef.current.clear()
    const allLists = [...technicalPhrases, ...secondCategoryPhrases, ...thirdCategoryPhrases]
    const selectedPhrase = allLists[Math.floor(Math.random() * allLists.length)]
    usedPhrasesRef.current.add(selectedPhrase)
    return selectedPhrase
  }, [executionStartTime])

  // Initialization and phrase cycling
  useEffect(() => {
    let cleanup: (() => void) | void
    const frame = requestAnimationFrame(() => {
      cleanup = (() => {
    if (!executionStartTime) {
      setCurrentPhrase("")
      isInitializedRef.current = false
      return
    }

    let timeoutIds: NodeJS.Timeout[] = []
    let isActive = true

    // Reset on new execution
    if (executionStartTime !== executionIdRef.current) {
      executionIdRef.current = executionStartTime
      usedPhrasesRef.current.clear()
      isInitializedRef.current = false
      
      // Set first phrase immediately
      const firstPhrase = getNextPhrase()
      setCurrentPhrase(firstPhrase)
      setAnimationState('entering')
      isInitializedRef.current = true
    }

    const cyclePhrase = () => {
      if (!isActive || !executionStartTime) return

      // Phase 1: Appear from bottom
      setAnimationState('entering')
      const newPhrase = getNextPhrase()
      setCurrentPhrase(newPhrase)

      // Phase 2: Visibility (2 seconds)
      const timeout1 = setTimeout(() => {
        if (isActive) {
          setAnimationState('visible')
        }
      }, 300) // Animation appearance time
      timeoutIds.push(timeout1)

      // Phase 3: Disappear upward
      const timeout2 = setTimeout(() => {
        if (isActive) {
          setAnimationState('exiting')
        }
      }, 2300) // 300ms appearance + 2000ms visibility
      timeoutIds.push(timeout2)

      // Phase 4: Next phrase
      const timeout3 = setTimeout(() => {
        if (isActive) {
          cyclePhrase()
        }
      }, 2800) // 300ms appearance + 2000ms visibility + 500ms disappearance
      timeoutIds.push(timeout3)
      cycleTimeoutRef.current = timeout3
    }

    // Start first animation cycle for current phrase
    if (isInitializedRef.current) {
      const timeout1 = setTimeout(() => {
        if (isActive) {
          setAnimationState('visible')
        }
      }, 300)
      timeoutIds.push(timeout1)

      const timeout2 = setTimeout(() => {
        if (isActive) {
          setAnimationState('exiting')
        }
      }, 2300)
      timeoutIds.push(timeout2)

      const timeout3 = setTimeout(() => {
        if (isActive) {
          cyclePhrase()
        }
      }, 2800)
      timeoutIds.push(timeout3)
      cycleTimeoutRef.current = timeout3
    }

    // Cleanup on unmount or executionStartTime change
    return () => {
      isActive = false
      timeoutIds.forEach(id => clearTimeout(id))
      if (cycleTimeoutRef.current) {
        clearTimeout(cycleTimeoutRef.current)
        cycleTimeoutRef.current = null
      }
      timeoutIds = []
    }

      })()
    })
    return () => { cancelAnimationFrame(frame); cleanup?.() }
  }, [executionStartTime])

  if (!executionStartTime) {
    return null
  }

  // Show fallback phrase if currentPhrase not yet set
  const displayPhrase = currentPhrase || technicalPhrases[0]

  return (
    <div className="relative overflow-hidden rounded-md border bg-background p-3 text-sm text-muted-foreground">
      <div
        className={`node-thought-line ${
          animationState === 'entering' ? 'node-thought-entering' :
          animationState === 'visible' ? 'node-thought-visible' :
          'node-thought-exiting'
        }`}
      >
        {displayPhrase}
      </div>
    </div>
  )
}

