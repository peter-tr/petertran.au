// Word pairs for the Imposter party game. Every player but one gets
// `civilian`; the odd one out gets `imposter`. Each category has two tiers:
// `normalPairs` are close enough that a sharp imposter can bluff without much
// effort (e.g. "Coffee" vs "Tea"); `hardPairs` still fit the same category
// but are a genuine, lateral-thinking leap to connect (e.g. "Coffee" vs
// "Popcorn") - not just "a different item from the same shelf".

export interface WordPair {
  civilian: string;
  imposter: string;
}

export type WordDifficulty = "NORMAL" | "HARD";

export interface WordCategory {
  id: string;
  label: string;
  normalPairs: WordPair[];
  hardPairs: WordPair[];
}

export const WORD_CATEGORIES: WordCategory[] = [
  {
    id: "food-drink",
    label: "Food & Drink",
    normalPairs: [
      { civilian: "Coffee", imposter: "Tea" },
      { civilian: "Pizza", imposter: "Burger" },
      { civilian: "Sushi", imposter: "Ramen" },
      { civilian: "Pancakes", imposter: "Waffles" },
      { civilian: "Ice Cream", imposter: "Gelato" },
      { civilian: "Wine", imposter: "Beer" },
      { civilian: "Chocolate", imposter: "Vanilla" },
      { civilian: "Apple", imposter: "Pear" },
      { civilian: "Bread", imposter: "Toast" },
      { civilian: "Soup", imposter: "Stew" },
      { civilian: "Taco", imposter: "Burrito" },
      { civilian: "Donut", imposter: "Muffin" },
      { civilian: "Milkshake", imposter: "Smoothie" },
      { civilian: "Hot Dog", imposter: "Sausage Roll" },
      { civilian: "Cheese", imposter: "Butter" },
    ],
    hardPairs: [
      { civilian: "Coffee", imposter: "Popcorn" },
      { civilian: "Pizza", imposter: "Ice Cream" },
      { civilian: "Sushi", imposter: "Pancakes" },
      { civilian: "Steak", imposter: "Donut" },
      { civilian: "Wine", imposter: "Milkshake" },
      { civilian: "Chocolate", imposter: "Salad" },
      { civilian: "Bread", imposter: "Sushi" },
      { civilian: "Cheese", imposter: "Smoothie" },
      { civilian: "Taco", imposter: "Cake" },
      { civilian: "Soup", imposter: "Donut" },
    ],
  },
  {
    id: "animals",
    label: "Animals",
    normalPairs: [
      { civilian: "Cat", imposter: "Dog" },
      { civilian: "Lion", imposter: "Tiger" },
      { civilian: "Horse", imposter: "Donkey" },
      { civilian: "Eagle", imposter: "Hawk" },
      { civilian: "Shark", imposter: "Dolphin" },
      { civilian: "Frog", imposter: "Toad" },
      { civilian: "Rabbit", imposter: "Hare" },
      { civilian: "Wolf", imposter: "Fox" },
      { civilian: "Turtle", imposter: "Tortoise" },
      { civilian: "Crocodile", imposter: "Alligator" },
      { civilian: "Bee", imposter: "Wasp" },
      { civilian: "Owl", imposter: "Bat" },
      { civilian: "Penguin", imposter: "Seal" },
      { civilian: "Camel", imposter: "Llama" },
      { civilian: "Butterfly", imposter: "Moth" },
    ],
    hardPairs: [
      { civilian: "Elephant", imposter: "Butterfly" },
      { civilian: "Shark", imposter: "Owl" },
      { civilian: "Snake", imposter: "Peacock" },
      { civilian: "Whale", imposter: "Bee" },
      { civilian: "Kangaroo", imposter: "Penguin" },
      { civilian: "Dolphin", imposter: "Spider" },
      { civilian: "Tiger", imposter: "Turtle" },
      { civilian: "Bee", imposter: "Camel" },
      { civilian: "Horse", imposter: "Octopus" },
      { civilian: "Fox", imposter: "Whale" },
    ],
  },
  {
    id: "places",
    label: "Places",
    normalPairs: [
      { civilian: "Beach", imposter: "Desert" },
      { civilian: "Mountain", imposter: "Hill" },
      { civilian: "City", imposter: "Town" },
      { civilian: "Forest", imposter: "Jungle" },
      { civilian: "Lake", imposter: "River" },
      { civilian: "Airport", imposter: "Train Station" },
      { civilian: "School", imposter: "University" },
      { civilian: "Hospital", imposter: "Clinic" },
      { civilian: "Castle", imposter: "Palace" },
      { civilian: "Farm", imposter: "Ranch" },
      { civilian: "Museum", imposter: "Library" },
      { civilian: "Park", imposter: "Garden" },
      { civilian: "Island", imposter: "Peninsula" },
      { civilian: "Cave", imposter: "Tunnel" },
      { civilian: "Village", imposter: "Suburb" },
    ],
    hardPairs: [
      { civilian: "Airport", imposter: "Cave" },
      { civilian: "School", imposter: "Beach" },
      { civilian: "City", imposter: "Farm" },
      { civilian: "Hospital", imposter: "Forest" },
      { civilian: "Castle", imposter: "Airport" },
      { civilian: "Park", imposter: "Hospital" },
      { civilian: "Village", imposter: "Museum" },
      { civilian: "Mountain", imposter: "School" },
      { civilian: "Farm", imposter: "Museum" },
      { civilian: "Desert", imposter: "Park" },
    ],
  },
  {
    id: "occupations",
    label: "Occupations",
    normalPairs: [
      { civilian: "Doctor", imposter: "Nurse" },
      { civilian: "Teacher", imposter: "Professor" },
      { civilian: "Police Officer", imposter: "Security Guard" },
      { civilian: "Chef", imposter: "Baker" },
      { civilian: "Pilot", imposter: "Flight Attendant" },
      { civilian: "Firefighter", imposter: "Paramedic" },
      { civilian: "Lawyer", imposter: "Judge" },
      { civilian: "Plumber", imposter: "Electrician" },
      { civilian: "Actor", imposter: "Director" },
      { civilian: "Farmer", imposter: "Gardener" },
      { civilian: "Photographer", imposter: "Painter" },
      { civilian: "Waiter", imposter: "Bartender" },
      { civilian: "Soldier", imposter: "Sailor" },
      { civilian: "Dentist", imposter: "Surgeon" },
      { civilian: "Journalist", imposter: "Blogger" },
    ],
    hardPairs: [
      { civilian: "Chef", imposter: "Judge" },
      { civilian: "Teacher", imposter: "Sailor" },
      { civilian: "Lawyer", imposter: "Photographer" },
      { civilian: "Actor", imposter: "Firefighter" },
      { civilian: "Photographer", imposter: "Farmer" },
      { civilian: "Journalist", imposter: "Pilot" },
      { civilian: "Police Officer", imposter: "Baker" },
      { civilian: "Nurse", imposter: "Director" },
      { civilian: "Judge", imposter: "Waiter" },
      { civilian: "Waiter", imposter: "Soldier" },
    ],
  },
  {
    id: "movies-tv",
    label: "Movies & TV",
    normalPairs: [
      { civilian: "Superhero Movie", imposter: "Action Movie" },
      { civilian: "Comedy", imposter: "Sitcom" },
      { civilian: "Horror Movie", imposter: "Thriller" },
      { civilian: "Cartoon", imposter: "Anime" },
      { civilian: "Documentary", imposter: "Reality Show" },
      { civilian: "Musical", imposter: "Opera" },
      { civilian: "Game Show", imposter: "Talk Show" },
      { civilian: "Soap Opera", imposter: "Drama Series" },
      { civilian: "Sci-Fi Movie", imposter: "Fantasy Movie" },
      { civilian: "News", imposter: "Podcast" },
      { civilian: "Rom-Com", imposter: "Drama Film" },
      { civilian: "Western", imposter: "War Movie" },
    ],
    hardPairs: [
      { civilian: "Documentary", imposter: "Musical" },
      { civilian: "Horror Movie", imposter: "Talk Show" },
      { civilian: "Musical", imposter: "Cartoon" },
      { civilian: "Sci-Fi Movie", imposter: "News" },
      { civilian: "Western", imposter: "Game Show" },
      { civilian: "Comedy", imposter: "War Movie" },
      { civilian: "Reality Show", imposter: "Anime" },
      { civilian: "Podcast", imposter: "Opera" },
      { civilian: "Talk Show", imposter: "Thriller" },
      { civilian: "Opera", imposter: "Western" },
    ],
  },
  {
    id: "sports-games",
    label: "Sports & Games",
    normalPairs: [
      { civilian: "Soccer", imposter: "Rugby" },
      { civilian: "Basketball", imposter: "Netball" },
      { civilian: "Tennis", imposter: "Badminton" },
      { civilian: "Chess", imposter: "Checkers" },
      { civilian: "Swimming", imposter: "Diving" },
      { civilian: "Boxing", imposter: "Wrestling" },
      { civilian: "Golf", imposter: "Mini Golf" },
      { civilian: "Cricket", imposter: "Baseball" },
      { civilian: "Skiing", imposter: "Snowboarding" },
      { civilian: "Cycling", imposter: "Running" },
      { civilian: "Poker", imposter: "Blackjack" },
      { civilian: "Volleyball", imposter: "Handball" },
      { civilian: "Darts", imposter: "Bowling" },
      { civilian: "Surfing", imposter: "Skateboarding" },
      { civilian: "Marathon", imposter: "Triathlon" },
    ],
    hardPairs: [
      { civilian: "Chess", imposter: "Surfing" },
      { civilian: "Golf", imposter: "Wrestling" },
      { civilian: "Poker", imposter: "Skiing" },
      { civilian: "Darts", imposter: "Marathon" },
      { civilian: "Tennis", imposter: "Bowling" },
      { civilian: "Skiing", imposter: "Chess" },
      { civilian: "Basketball", imposter: "Darts" },
      { civilian: "Cricket", imposter: "Volleyball" },
      { civilian: "Bowling", imposter: "Cycling" },
      { civilian: "Running", imposter: "Poker" },
    ],
  },
  {
    id: "everyday-objects",
    label: "Everyday Objects",
    normalPairs: [
      { civilian: "Phone", imposter: "Tablet" },
      { civilian: "Laptop", imposter: "Desktop" },
      { civilian: "Backpack", imposter: "Suitcase" },
      { civilian: "Umbrella", imposter: "Raincoat" },
      { civilian: "Sunglasses", imposter: "Glasses" },
      { civilian: "Wallet", imposter: "Purse" },
      { civilian: "Watch", imposter: "Clock" },
      { civilian: "Pen", imposter: "Pencil" },
      { civilian: "Chair", imposter: "Stool" },
      { civilian: "Sofa", imposter: "Armchair" },
      { civilian: "Mirror", imposter: "Window" },
      { civilian: "Candle", imposter: "Lamp" },
      { civilian: "Blanket", imposter: "Pillow" },
      { civilian: "Keyboard", imposter: "Mouse" },
      { civilian: "Headphones", imposter: "Earphones" },
    ],
    hardPairs: [
      { civilian: "Umbrella", imposter: "Keyboard" },
      { civilian: "Wallet", imposter: "Mirror" },
      { civilian: "Mirror", imposter: "Blanket" },
      { civilian: "Chair", imposter: "Wallet" },
      { civilian: "Watch", imposter: "Sofa" },
      { civilian: "Pen", imposter: "Umbrella" },
      { civilian: "Laptop", imposter: "Candle" },
      { civilian: "Sunglasses", imposter: "Chair" },
      { civilian: "Suitcase", imposter: "Pen" },
      { civilian: "Clock", imposter: "Mouse" },
    ],
  },
];

export function findWordCategory(categoryId: string): WordCategory | undefined {
  return WORD_CATEGORIES.find((c) => c.id === categoryId);
}

export function randomPair(category: WordCategory, difficulty: WordDifficulty): WordPair {
  const pairs = difficulty === "HARD" ? category.hardPairs : category.normalPairs;
  return pairs[Math.floor(Math.random() * pairs.length)];
}
